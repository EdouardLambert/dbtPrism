// tests/core/analyzer/columnHover.test.ts

import * as path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { WorkspaceIndexer } from '../../../src/core/indexer/workspaceIndexer.js';
import { SqlScopeAnalyzer } from '../../../src/core/analyzer/sqlScopeAnalyzer.js';
import { extractCursor } from '../../helpers/cursorTestHarness.js';

describe('SqlScopeAnalyzer - Column Hover Information Box', () => {
  let indexer: WorkspaceIndexer;
  let analyzer: SqlScopeAnalyzer;

  beforeAll(async () => {
    indexer = new WorkspaceIndexer();
    const playgroundDir = path.resolve(process.cwd(), 'playground/jaffle_prism');
    await indexer.indexWorkspaceFolder(playgroundDir);
    analyzer = new SqlScopeAnalyzer(indexer);
  });

  it('returns rich column metadata when hovering over a qualified model column (cus.customer_id)', () => {
    const query = `
      select cus.customer|_id
      from {{ ref('customers') }} as cus
    `;
    const { sql, cursorOffset } = extractCursor(query);

    const hover = analyzer.computeHover(sql, cursorOffset);

    expect(hover).not.toBeNull();
    expect(hover?.candidate).toMatchObject({
      label: 'customer_id',
      dataType: 'INTEGER',
      sourceName: 'customers',
      sourceKind: 'table',
      documentation: 'Primary key of the customer',
      constraints: ['primary_key', 'not_null'],
      dataTests: ['unique', 'not_null'],
    });
  });

  it('returns CTE column metadata when hovering over a qualified CTE column (v.net_revenue_usd)', () => {
    const query = `
      with vip_orders as (
        select order_id, amount_usd as net_revenue_usd
        from {{ ref('stg_orders') }}
      )
      select v.net_rev|enue_usd
      from vip_orders as v
    `;
    const { sql, cursorOffset } = extractCursor(query);

    const hover = analyzer.computeHover(sql, cursorOffset);

    expect(hover).not.toBeNull();
    expect(hover?.candidate).toMatchObject({
      label: 'net_revenue_usd',
      dataType: 'NUMERIC',
      sourceName: 'vip_orders',
      sourceKind: 'cte',
    });
  });

  it('resolves unqualified columns inside WHERE and SELECT clauses', () => {
    const query = `
      with vip_orders as (
        select order_id, amount_usd
        from {{ ref('stg_orders') }}
        where order_st|atus = 'placed'
      )
      select * from vip_orders
    `;
    const { sql, cursorOffset } = extractCursor(query);

    const hover = analyzer.computeHover(sql, cursorOffset);

    expect(hover).not.toBeNull();
    expect(hover?.candidate).toMatchObject({
      label: 'order_status',
      dataType: 'VARCHAR',
      sourceName: 'stg_orders',
      sourceKind: 'view',
    });
  });

  it('infers type and metadata when hovering over an aggregated alias definition in a CTE', () => {
    const query = `
      with order_metrics as (
        select
          customer_id,
          count(order_id) as lifetime_orders|_count
        from {{ ref('stg_orders') }}
        group by customer_id
      )
      select * from order_metrics
    `;
    const { sql, cursorOffset } = extractCursor(query);

    const hover = analyzer.computeHover(sql, cursorOffset);

    expect(hover).not.toBeNull();
    expect(hover?.candidate).toMatchObject({
      label: 'lifetime_orders_count',
      dataType: 'BIGINT',
    });
  });

  it('returns table materialization and schema.yml description on table alias hover, and ignores ref()', () => {
    const refHover = extractCursor(
      "select * from {{ ref('stg_cust|omers') }} as sc"
    );
    expect(analyzer.computeHover(refHover.sql, refHover.cursorOffset)).toBeNull();

    const aliasHover = extractCursor(
      "select s|c.customer_id from {{ ref('stg_customers') }} as sc"
    );
    expect(analyzer.computeHover(aliasHover.sql, aliasHover.cursorOffset)?.candidate).toMatchObject({
      label: 'sc',
      kind: 'model',
      sourceName: 'stg_customers',
      sourceKind: 'view',
      documentation: 'Cleaned customer records from raw CRM',
    });
  });

  it('returns null when hovering over SQL keywords or comments', () => {
    const keywordHover = extractCursor(
      "sel|ect cus.customer_id from {{ ref('customers') }} as cus"
    );
    expect(analyzer.computeHover(keywordHover.sql, keywordHover.cursorOffset)).toBeNull();

    const commentHover = extractCursor(
      "-- customer|_id in comment\nselect cus.customer_id from {{ ref('customers') }} as cus"
    );
    expect(analyzer.computeHover(commentHover.sql, commentHover.cursorOffset)).toBeNull();
  });
});