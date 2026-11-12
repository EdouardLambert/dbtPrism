// tests/core/analyzer/cteLineage.test.ts

import { describe, expect, it, beforeEach } from 'vitest';
import { SqlScopeAnalyzer } from '../../../src/core/analyzer/sqlScopeAnalyzer.js';
import { extractCursor, InMemoryMetadataRegistry } from '../../helpers/cursorTestHarness.js';

describe('SqlScopeAnalyzer - Local CTE Resolution & Lineage', () => {
  let registry: InMemoryMetadataRegistry;
  let analyzer: SqlScopeAnalyzer;

  beforeEach(() => {
    registry = new InMemoryMetadataRegistry();
    registry.registerModel({
      name: 'stg_users',
      filePath: 'models/staging/stg_users.sql',
      materialized: 'view',
      refs: [],
      lastUpdated: Date.now(),
      columns: new Map([
        [
          'user_id',
          {
            name: 'user_id',
            dataType: 'INTEGER',
            description: 'Unique user identifier',
            origin: 'schema_yml',
            sourceModelName: 'stg_users',
          },
        ],
        [
          'created_at',
          {
            name: 'created_at',
            dataType: 'TIMESTAMP',
            description: 'Account creation timestamp',
            origin: 'schema_yml',
            sourceModelName: 'stg_users',
          },
        ],
      ]),
    });

    analyzer = new SqlScopeAnalyzer(registry);
  });

  it('infers explicit columns and column aliases from a standalone local CTE', () => {
    const query = `
      with raw_events as (
        select
          event_id,
          user_id as customer_id,
          payload
        from external_events_table
      )
      select raw_events.|
      from raw_events
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions.map((c) => c.label)).toEqual(['event_id', 'customer_id', 'payload']);
  });

  it('propagates column metadata (types & descriptions) across chained SELECT * CTEs', () => {
    const query = `
      with base_users as (
        select * from {{ ref('stg_users') }}
      ),
      active_users as (
        select * from base_users
      )
      select active_users.|
      from active_users
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions).toHaveLength(2);
    expect(completions[0]).toMatchObject({
      label: 'user_id',
      detail: 'INTEGER • active_users (cte)',
      documentation: 'Unique user identifier',
    });
  });

  it('expands qualified star (SELECT alias.*) only for the targeted relation in a CTE', () => {
    const query = `
      with u as (
        select user_id from {{ ref('stg_users') }}
      ),
      extra as (
        select extra_col from other_source
      ),
      combined as (
        select u.*
        from u
        join extra on u.user_id = extra.extra_col
      )
      select combined.|
      from combined
    `;

    const { sql, cursorOffset } = extractCursor(query);
    const completions = analyzer.computeCompletions(sql, cursorOffset);

    expect(completions.map((c) => c.label)).toEqual(['user_id']);
  });
});