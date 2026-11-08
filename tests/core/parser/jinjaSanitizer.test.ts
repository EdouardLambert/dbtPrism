// tests/core/parser/jinjaSanitizer.test.ts

import { describe, expect, it } from 'vitest';
import { sanitizeJinjaSql } from '../../../src/core/parser/jinjaSanitizer.js';

describe('jinjaSanitizer - Offset-Preserving Jinja Masking', () => {
  it('preserves exact string length and line count when masking config, comments, and refs', () => {
    const rawSql = [
      "{{ config(materialized='incremental', unique_key='id') }}",
      '{# This is a multi-line',
      '   Jinja comment #}',
      'select *',
      "from {{ ref('stg_customers') }}",
      '{% if is_incremental() %}',
      'where updated_at > (select max(updated_at) from {{ this }})',
      '{% endif %}',
    ].join('\n');

    const { sanitizedSql } = sanitizeJinjaSql(rawSql);

    expect(sanitizedSql.length).toBe(rawSql.length);
    expect(sanitizedSql.split('\n').length).toBe(rawSql.split('\n').length);
    expect(sanitizedSql).not.toContain('{{');
    expect(sanitizedSql).not.toContain('{%');
    expect(sanitizedSql).not.toContain('{#');
  });

  it('extracts single-argument and two-argument (versioned/package) dbt ref() calls', () => {
    const rawSql = `
      select *
      from {{ ref('customers') }} c
      join {{ ref('marketing_pkg', 'campaigns') }} m on c.id = m.customer_id
    `;

    const { relations } = sanitizeJinjaSql(rawSql);
    const extractedModels = Array.from(relations.values()).map((r) => r.modelOrTableName);

    expect(extractedModels).toEqual(['customers', 'campaigns']);
  });

  it('extracts dbt source() calls with sourceName and tableName', () => {
    const rawSql = "select * from {{ source('stripe', 'payments') }}";

    const { relations } = sanitizeJinjaSql(rawSql);
    const tokens = Array.from(relations.values());

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'source',
      sourceName: 'stripe',
      modelOrTableName: 'payments',
    });
  });
});