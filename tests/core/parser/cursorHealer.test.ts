// tests/core/parser/cursorHealer.test.ts

import { describe, expect, it } from 'vitest';
import { sanitizeJinjaSql } from '../../../src/core/parser/jinjaSanitizer.js';
import {
  CURSOR_SYNTHETIC_TOKEN,
  healSqlAtCursor,
} from '../../../src/core/parser/cursorHealer.js';
import { extractCursor } from '../../helpers/cursorTestHarness.js';

describe('cursorHealer - Intent Detection & Broken SQL Repair', () => {
  it('detects DOT_COMPLETION when cursor is immediately after a table dot', () => {
    const { sql, cursorOffset } = extractCursor('SELECT customers.| FROM customers');
    const { sanitizedSql } = sanitizeJinjaSql(sql);

    const healed = healSqlAtCursor(sql, sanitizedSql, cursorOffset);

    expect(healed.intent).toBe('DOT_COMPLETION');
    expect(healed.qualifier).toBe('customers');
    expect(healed.prefix).toBe('');
    expect(healed.healedSql).toBe(`SELECT customers.${CURSOR_SYNTHETIC_TOKEN} FROM customers`);
  });

  it('detects DOT_COMPLETION with partial column prefix', () => {
    const { sql, cursorOffset } = extractCursor('SELECT c.em| FROM customers c');
    const { sanitizedSql } = sanitizeJinjaSql(sql);

    const healed = healSqlAtCursor(sql, sanitizedSql, cursorOffset);

    expect(healed.intent).toBe('DOT_COMPLETION');
    expect(healed.qualifier).toBe('c');
    expect(healed.prefix).toBe('em');
    expect(healed.healedSql).toBe(`SELECT c.${CURSOR_SYNTHETIC_TOKEN} FROM customers c`);
  });

  it('detects DBT_REF_ARGUMENT when cursor is inside ref quotes', () => {
    const { sql, cursorOffset } = extractCursor("SELECT * FROM {{ ref('stg_cus|') }}");
    const { sanitizedSql } = sanitizeJinjaSql(sql);

    const healed = healSqlAtCursor(sql, sanitizedSql, cursorOffset);

    expect(healed.intent).toBe('DBT_REF_ARGUMENT');
    expect(healed.prefix).toBe('stg_cus');
  });

  it('detects TABLE_OR_MODEL when typing after FROM or JOIN keywords', () => {
    const { sql, cursorOffset } = extractCursor('SELECT * FROM customers JOIN ord|');
    const { sanitizedSql } = sanitizeJinjaSql(sql);

    const healed = healSqlAtCursor(sql, sanitizedSql, cursorOffset);

    expect(healed.intent).toBe('TABLE_OR_MODEL');
    expect(healed.prefix).toBe('ord');
  });
});