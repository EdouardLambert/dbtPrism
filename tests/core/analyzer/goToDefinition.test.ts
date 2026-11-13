// tests/core/analyzer/goToDefinition.test.ts

import * as path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { WorkspaceIndexer } from '../../../src/core/indexer/workspaceIndexer.js';
import { SqlScopeAnalyzer } from '../../../src/core/analyzer/sqlScopeAnalyzer.js';
import { extractCursor } from '../../helpers/cursorTestHarness.js';

describe('SqlScopeAnalyzer - Go to Definition (Ctrl+Click)', () => {
  let indexer: WorkspaceIndexer;
  let analyzer: SqlScopeAnalyzer;
  let playgroundDir: string;

  beforeAll(async () => {
    indexer = new WorkspaceIndexer();
    playgroundDir = path.resolve(process.cwd(), 'playground/jaffle_prism');
    await indexer.indexWorkspaceFolder(playgroundDir);
    analyzer = new SqlScopeAnalyzer(indexer);
  });

  it('jumps first to the FROM alias when Ctrl+Clicking a table qualifier in SELECT (default from_alias mode)', () => {
    const query = [
      'select cu|s.customer_id',
      "from {{ ref('customers') }} as cus",
    ].join('\n');
    const { sql, cursorOffset } = extractCursor(query);

    const loc = analyzer.computeDefinition(sql, cursorOffset, '/tmp/sandbox.sql');

    expect(loc).toEqual({
      filePath: '/tmp/sandbox.sql',
      line: 1,
      startColumn: 31,
      endColumn: 34,
    });
  });

  it('jumps directly to the model .sql file when tableTargetMode is set to source_model', () => {
    const query = [
      'select cu|s.customer_id',
      "from {{ ref('customers') }} as cus",
    ].join('\n');
    const { sql, cursorOffset } = extractCursor(query);

    const loc = analyzer.computeDefinition(sql, cursorOffset, '/tmp/sandbox.sql', {
      tableTargetMode: 'source_model',
    });

    expect(loc).not.toBeNull();
    expect(loc?.filePath).toBe(path.join(playgroundDir, 'models/marts/customers.sql'));
    expect(loc?.line).toBe(0);
  });

  it('jumps to the model .sql file when Ctrl+Clicking inside {{ ref("customers") }} next to the alias', () => {
    const query = `select * from {{ ref('cust|omers') }} as cus`;
    const { sql, cursorOffset } = extractCursor(query);

    const loc = analyzer.computeDefinition(sql, cursorOffset, '/tmp/sandbox.sql');

    expect(loc).not.toBeNull();
    expect(loc?.filePath).toBe(path.join(playgroundDir, 'models/marts/customers.sql'));
    expect(loc?.line).toBe(0);
  });

  it('supports 2-step navigation for CTEs: SELECT v.col -> FROM vip_orders as v -> WITH vip_orders AS (', () => {
    // Step 1: Click `v` in `select v.net_revenue_usd` -> jumps to `as v` on line 5
    const step1Query = [
      'with vip_orders as (',
      '    select order_id, amount_usd as net_revenue_usd',
      "    from {{ ref('stg_orders') }}",
      ')',
      'select v|.net_revenue_usd',
      'from vip_orders as v',
    ].join('\n');

    const step1 = extractCursor(step1Query);
    const step1Loc = analyzer.computeDefinition(
      step1.sql,
      step1.cursorOffset,
      '/tmp/sandbox.sql'
    );

    expect(step1Loc).toEqual({
      filePath: '/tmp/sandbox.sql',
      line: 5,
      startColumn: 19,
      endColumn: 20,
    });

    // Step 2: Click `vip_orders` in `from vip_orders as v` -> jumps to `with vip_orders as (` on line 0
    const step2Query = [
      'with vip_orders as (',
      '    select order_id, amount_usd as net_revenue_usd',
      "    from {{ ref('stg_orders') }}",
      ')',
      'select v.net_revenue_usd',
      'from vip_|orders as v',
    ].join('\n');

    const step2 = extractCursor(step2Query);
    const step2Loc = analyzer.computeDefinition(
      step2.sql,
      step2.cursorOffset,
      '/tmp/sandbox.sql'
    );

    expect(step2Loc).toEqual({
      filePath: '/tmp/sandbox.sql',
      line: 0,
      startColumn: 5,
      endColumn: 15,
    });
  });

  it('jumps directly to the column projection inside the local CTE when Ctrl+Clicking a CTE column', () => {
    const query = [
      'with vip_orders as (',
      '    select',
      '        order_id,',
      '        amount_usd as net_revenue_usd',
      "    from {{ ref('stg_orders') }}",
      ')',
      'select v.net_rev|enue_usd',
      'from vip_orders as v',
    ].join('\n');

    const { sql, cursorOffset } = extractCursor(query);
    const loc = analyzer.computeDefinition(sql, cursorOffset, '/tmp/sandbox.sql');

    expect(loc).toEqual({
      filePath: '/tmp/sandbox.sql',
      line: 3,
      startColumn: 22,
      endColumn: 37,
    });
  });

  it('supports multi-hop Ctrl+Click on columns: from sandbox -> customers.sql -> order_metrics CTE', () => {
    const sandboxQuery = `
      select cus.lifetime_spend|_usd
      from {{ ref('customers') }} as cus
    `;
    const hop1Input = extractCursor(sandboxQuery);
    const hop1Loc = analyzer.computeDefinition(
      hop1Input.sql,
      hop1Input.cursorOffset,
      '/tmp/sandbox.sql'
    );

    const customersPath = path.join(playgroundDir, 'models/marts/customers.sql');
    expect(hop1Loc?.filePath).toBe(customersPath);
    expect(hop1Loc?.line).toBe(14);

    const customersQuery = [
      "{{ config(materialized='table') }}",
      '',
      'with order_metrics as (',
      '    select',
      '        customer_id,',
      '        count(order_id) as lifetime_orders_count,',
      '        sum(amount_usd) as lifetime_spend_usd',
      "    from {{ ref('stg_orders') }}",
      '    group by customer_id',
      ')',
      '',
      'select',
      '    c.*,',
      '    m.lifetime_orders_count,',
      '    m.lifetime_spend|_usd',
      "from {{ ref('stg_customers') }} as c",
      'left join order_metrics as m on c.customer_id = m.customer_id',
    ].join('\n');

    const hop2Input = extractCursor(customersQuery);
    const hop2Loc = analyzer.computeDefinition(
      hop2Input.sql,
      hop2Input.cursorOffset,
      customersPath
    );

    expect(hop2Loc).toEqual({
      filePath: customersPath,
      line: 6,
      startColumn: 27,
      endColumn: 45,
    });
  });

  it('jumps directly to stg_customers.sql when Ctrl+Clicking a column passed through SELECT c.* in customers.sql', () => {
    const query = `
      select cus.first_|name
      from {{ ref('customers') }} as cus
    `;
    const { sql, cursorOffset } = extractCursor(query);
    const loc = analyzer.computeDefinition(sql, cursorOffset, '/tmp/sandbox.sql');

    expect(loc?.filePath).toBe(
      path.join(playgroundDir, 'models/staging/stg_customers.sql')
    );
  });
});