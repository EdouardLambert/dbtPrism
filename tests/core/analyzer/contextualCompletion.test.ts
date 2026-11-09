// tests/core/analyzer/contextualCompletion.test.ts

import { describe, expect, it, beforeEach } from 'vitest';
import { SqlScopeAnalyzer } from '../../../src/core/analyzer/sqlScopeAnalyzer.js';
import { extractCursor, InMemoryMetadataRegistry } from '../../helpers/cursorTestHarness.js';

describe('SqlScopeAnalyzer - Contextual Completion Matrix & Priority', () => {
  let registry: InMemoryMetadataRegistry;
  let analyzer: SqlScopeAnalyzer;

  beforeEach(() => {
    registry = new InMemoryMetadataRegistry();

    registry.registerModel({
      name: 'customers',
      filePath: 'models/customers.sql',
      materialized: 'table',
      refs: [],
      lastUpdated: Date.now(),
      columns: new Map([
        ['customer_id', { name: 'customer_id', dataType: 'INT', origin: 'schema_yml' }],
        ['email', { name: 'email', dataType: 'VARCHAR', origin: 'schema_yml' }],
      ]),
    });

    registry.registerModel({
      name: 'customers_snapshot',
      filePath: 'snapshots/customers_snapshot.sql',
      materialized: 'snapshot',
      refs: [],
      lastUpdated: Date.now(),
      columns: new Map(),
    });

    registry.registerModel({
      name: 'orders',
      filePath: 'models/orders.sql',
      materialized: 'view',
      refs: [],
      lastUpdated: Date.now(),
      columns: new Map([
        ['order_id', { name: 'order_id', dataType: 'INT', origin: 'schema_yml' }],
        ['customer_id', { name: 'customer_id', dataType: 'INT', origin: 'schema_yml' }],
      ]),
    });

    analyzer = new SqlScopeAnalyzer(registry);
  });

  it('inserts unqualified column name when only a single table is in scope', () => {
    const query = `
      select em|
      from {{ ref('customers') }}
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions).toHaveLength(1);
    expect(completions[0]?.label).toBe('email');
    expect(completions[0]?.insertText).toBe('email');
  });

  it('inserts qualified alias.column when multiple tables are joined, even for non-ambiguous columns', () => {
    const query = `
      select em|
      from {{ ref('customers') }} as c
      join {{ ref('orders') }} as o on c.customer_id = o.customer_id
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions).toHaveLength(1);
    expect(completions[0]?.label).toBe('c.email');
    expect(completions[0]?.insertText).toBe('c.email');
  });

  it('ranks matching table alias FIRST, then its columns, then other joined tables columns (Screen 3 scenario)', () => {
    const query = `
      with vip_orders as (
        select order_id, customer_id from {{ ref('orders') }}
      )
      select c|
      from {{ ref('customers') }} as cus
      join vip_orders as vip on cus.customer_id = vip.customer_id
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions.map((c) => c.label)).toEqual([
      'cus',
      'cus.customer_id',
      'vip.customer_id',
    ]);
  });

  it('proposes dbt models formatted as ref() snippets when typing in a FROM clause', () => {
    const query = `
      select *
      from cus|
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions.map((c) => c.label)).toEqual(['customers', 'customers_snapshot']);
    expect(completions[0]?.insertText).toBe("{{ ref('customers') }} as customers");
  });

  it('proposes raw model names without ref() wrapper when cursor is already inside {{ ref("...") }}', () => {
    const query = `
      select *
      from {{ ref('cus|') }}
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions.map((c) => c.label)).toEqual(['customers', 'customers_snapshot']);
    expect(completions[0]?.insertText).toBe('customers');
  });
});