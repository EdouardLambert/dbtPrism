// tests/core/indexer/workspaceIndexer.test.ts

import * as path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { WorkspaceIndexer } from '../../../src/core/indexer/workspaceIndexer.js';
import { SqlScopeAnalyzer } from '../../../src/core/analyzer/sqlScopeAnalyzer.js';
import { extractCursor } from '../../helpers/cursorTestHarness.js';

describe('WorkspaceIndexer - Integration with playground/jaffle_prism', () => {
  let indexer: WorkspaceIndexer;
  let analyzer: SqlScopeAnalyzer;

  beforeAll(async () => {
    indexer = new WorkspaceIndexer();
    const playgroundDir = path.resolve(process.cwd(), 'playground/jaffle_prism');
    await indexer.indexWorkspaceFolder(playgroundDir);
    analyzer = new SqlScopeAnalyzer(indexer);
  });

  it('indexes all dbt models from playground/jaffle_prism with their materializations', () => {
    expect(indexer.getModel('stg_customers')?.materialized).toBe('view');
    expect(indexer.getModel('customers')?.materialized).toBe('table');
  });

  it('merges schema.yml columns, constraints, and data_tests with SQL-inferred columns', () => {
    const stgCustomers = indexer.getModel('stg_customers');
    expect(stgCustomers).toBeDefined();

    const cols = stgCustomers!.columns;

    expect(cols.get('customer_id')).toMatchObject({
      name: 'customer_id',
      dataType: 'INTEGER',
      description: 'Primary key of the customer',
      origin: 'schema_yml',
      sourceKind: 'view',
      constraints: ['primary_key', 'not_null'],
      dataTests: ['unique', 'not_null'],
    });

    expect(cols.get('first_name')).toMatchObject({
      name: 'first_name',
      origin: 'sql_inferred',
      sourceKind: 'view',
    });

    expect(cols.get('signup_date')).toMatchObject({
      name: 'signup_date',
      dataType: 'DATE',
      origin: 'sql_inferred',
      sourceKind: 'view',
    });
  });

  it('resolves cross-model SELECT c.* and CTE aggregations with inferred types in marts/customers.sql', () => {
    const customersModel = indexer.getModel('customers');
    expect(customersModel).toBeDefined();

    const cols = customersModel!.columns;
    expect(Array.from(cols.keys())).toEqual([
      'customer_id',
      'email',
      'first_name',
      'last_name',
      'signup_date',
      'lifetime_orders_count',
      'lifetime_spend_usd',
    ]);

    expect(cols.get('lifetime_orders_count')).toMatchObject({
      dataType: 'BIGINT',
      sourceModelName: 'order_metrics',
      sourceKind: 'cte',
    });
  });

  it('propagates constraints, data_tests, and sourceKind to completion candidates', () => {
    const query = `
      select c.|
      from {{ ref('customers') }} as c
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);
    const customerIdCandidate = completions.find((c) => c.label === 'customer_id');

    expect(customerIdCandidate).toMatchObject({
      label: 'customer_id',
      dataType: 'INTEGER',
      sourceName: 'stg_customers',
      sourceKind: 'view',
      documentation: 'Primary key of the customer',
      constraints: ['primary_key', 'not_null'],
      dataTests: ['unique', 'not_null'],
    });
  });

  it('strips ref() wrapper from foreign_key constraints and relationships data_tests', () => {
    const stgOrders = indexer.getModel('stg_orders');
    const fkCol = stgOrders?.columns.get('customer_id');

    expect(fkCol?.constraints).toEqual(['foreign_key -> stg_customers']);
    expect(fkCol?.dataTests).toEqual(['relationships -> stg_customers.customer_id']);
  });
});