// src/core/parser/cursorHealer.ts

import { CursorIntentType, HealedSqlContext } from '../types.js';

export const CURSOR_SYNTHETIC_TOKEN = '__prism_cursor__';

const INSIDE_REF_REGEX = /\{\{\s*ref\(\s*['"]([^'"]*)$/;
const DOT_PREFIX_REGEX = /([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)$/;
const TABLE_CLAUSE_REGEX = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_]*)$/i;
const IDENTIFIER_PREFIX_REGEX = /([a-zA-Z0-9_]+)$/;

/**
 * Inspects the raw and sanitized SQL around the cursor offset, determines user intent,
 * and repairs incomplete SQL syntax so the AST parser succeeds.
 */
export function healSqlAtCursor(
  rawSql: string,
  sanitizedSql: string,
  cursorOffset: number
): HealedSqlContext {
  const rawBeforeCursor = rawSql.slice(0, cursorOffset);

  // 1. Fast-path: Cursor is inside {{ ref('...') }}
  const refMatch = INSIDE_REF_REGEX.exec(rawBeforeCursor);
  if (refMatch) {
    return {
      healedSql: sanitizedSql,
      intent: 'DBT_REF_ARGUMENT',
      prefix: refMatch[1] ?? '',
      cursorOffset,
    };
  }

  const sanitizedBefore = sanitizedSql.slice(0, cursorOffset);
  const sanitizedAfter = sanitizedSql.slice(cursorOffset);

  // 2. Dot completion: e.g. "customers." or "customers.em"
  const dotMatch = DOT_PREFIX_REGEX.exec(sanitizedBefore);
  if (dotMatch) {
    const qualifier = dotMatch[1] ?? '';
    const prefix = dotMatch[2] ?? '';
    const baseBeforePrefix = sanitizedBefore.slice(0, sanitizedBefore.length - prefix.length);

    return {
      healedSql: `${baseBeforePrefix}${CURSOR_SYNTHETIC_TOKEN}${sanitizedAfter}`,
      intent: 'DOT_COMPLETION',
      qualifier,
      prefix,
      cursorOffset,
    };
  }

  // 3. Table/Model completion right after FROM or JOIN: e.g. "FROM cus"
  const tableMatch = TABLE_CLAUSE_REGEX.exec(sanitizedBefore);
  if (tableMatch) {
    const prefix = tableMatch[1] ?? '';
    const baseBeforePrefix = sanitizedBefore.slice(0, sanitizedBefore.length - prefix.length);

    return {
      healedSql: `${baseBeforePrefix}${CURSOR_SYNTHETIC_TOKEN}${sanitizedAfter}`,
      intent: 'TABLE_OR_MODEL',
      prefix,
      cursorOffset,
    };
  }

  // 4. Unqualified column or general expression inside SELECT / WHERE / GROUP BY
  const idMatch = IDENTIFIER_PREFIX_REGEX.exec(sanitizedBefore);
  const prefix = idMatch ? (idMatch[1] ?? '') : '';
  const baseBeforePrefix = sanitizedBefore.slice(0, sanitizedBefore.length - prefix.length);

  const intent: CursorIntentType = 'UNQUALIFIED_COLUMN';
  return {
    healedSql: `${baseBeforePrefix}${CURSOR_SYNTHETIC_TOKEN}${sanitizedAfter}`,
    intent,
    prefix,
    cursorOffset,
  };
}