// src/core/parser/sqlLocationFinder.ts

import { DbtRelationToken, SourceLocation } from '../types.js';

export interface CteLocationBlock {
  cteName: string;
  nameLocation: SourceLocation;
  bodyStartOffset: number;
  bodyEndOffset: number;
}

export interface CursorDefinitionToken {
  word: string;
  qualifier?: string;
  isQualifierBeforeDot: boolean;
  isAfterFromOrJoin: boolean;
  startOffset: number;
  endOffset: number;
}

const SQL_COMMENT_OR_STRING_REGEX = /(--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*')/g;

const STOP_CLAUSE_AT_DEPTH_ZERO_REGEX =
  /^\b(?:FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|QUALIFY|WINDOW|UNION|EXCEPT|INTERSECT)\b/i;

/**
 * Masks SQL comments and string literals with spaces while preserving exact byte length and newlines.
 */
export function maskCommentsAndStrings(sql: string): string {
  return sql.replace(SQL_COMMENT_OR_STRING_REGEX, (match) =>
    match.replace(/[^\r\n]/g, ' ')
  );
}

/**
 * Converts a 0-based character range [startOffset, endOffset] into a 0-based SourceLocation.
 */
export function offsetRangeToSourceLocation(
  text: string,
  filePath: string,
  startOffset: number,
  endOffset: number
): SourceLocation {
  let line = 0;
  let lastNewlineIdx = -1;

  const clampedStart = Math.max(0, Math.min(startOffset, text.length));
  for (let i = 0; i < clampedStart; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNewlineIdx = i;
    }
  }

  const startColumn = clampedStart - (lastNewlineIdx + 1);
  const length = Math.max(0, endOffset - startOffset);

  return {
    filePath,
    line,
    startColumn,
    endColumn: startColumn + length,
  };
}

/**
 * Finds all CTE definitions (`WITH name AS (...)`) at parenthesis depth 0,
 * returning their header name location and body offset boundaries.
 */
export function locateCteDefinitions(
  sanitizedSql: string,
  filePath: string
): Map<string, CteLocationBlock> {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const result = new Map<string, CteLocationBlock>();

  let depth = 0;
  let i = 0;
  const len = cleanSql.length;

  while (i < len) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      const slice = cleanSql.slice(i);
      const cteHeaderMatch = /^([a-zA-Z0-9_]+)\s+AS\s*\(/i.exec(slice);
      // Ensure we are at a word boundary
      const prevChar = i > 0 ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (cteHeaderMatch && !/[a-zA-Z0-9_]/.test(prevChar)) {
        const rawCteName = cteHeaderMatch[1] ?? '';
        const nameStart = i;
        const nameEnd = i + rawCteName.length;
        const openParenOffset = i + cteHeaderMatch[0].length - 1;

        // Scan forward to find matching closing parenthesis
        let innerDepth = 1;
        let j = openParenOffset + 1;
        while (j < len && innerDepth > 0) {
          if (cleanSql[j] === '(') innerDepth++;
          else if (cleanSql[j] === ')') innerDepth--;
          j++;
        }

        const closeParenOffset = j - 1;
        result.set(rawCteName.toLowerCase(), {
          cteName: rawCteName,
          nameLocation: offsetRangeToSourceLocation(
            sanitizedSql,
            filePath,
            nameStart,
            nameEnd
          ),
          bodyStartOffset: openParenOffset + 1,
          bodyEndOffset: Math.max(openParenOffset + 1, closeParenOffset),
        });

        i = j;
        continue;
      }
    }

    i++;
  }

  return result;
}

/**
 * Locates the exact SourceLocation of every explicitly projected column inside a SELECT block
 * bounded by [blockStartOffset, blockEndOffset].
 */
export function locateSelectProjectionColumns(
  sanitizedSql: string,
  filePath: string,
  blockStartOffset: number,
  blockEndOffset: number
): Map<string, SourceLocation> {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const locations = new Map<string, SourceLocation>();

  // 1. Find the first top-level SELECT keyword inside [blockStartOffset, blockEndOffset]
  let depth = 0;
  let selectEndOffset = -1;

  for (let i = blockStartOffset; i < blockEndOffset; i++) {
    const ch = cleanSql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const prevChar = i > blockStartOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        const selectMatch = /^SELECT(?:\s+(?:DISTINCT|ALL))?\b/i.exec(
          cleanSql.slice(i, blockEndOffset)
        );
        if (selectMatch) {
          selectEndOffset = i + selectMatch[0].length;
          break;
        }
      }
    }
  }

  if (selectEndOffset === -1) {
    return locations;
  }

  // 2. Collect top-level comma-separated projection item spans until top-level FROM/WHERE/etc.
  const itemSpans: Array<{ start: number; end: number }> = [];
  let itemStart = selectEndOffset;
  depth = 0;

  for (let i = selectEndOffset; i < blockEndOffset; i++) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      if (ch === ',') {
        itemSpans.push({ start: itemStart, end: i });
        itemStart = i + 1;
        continue;
      }

      const prevChar = i > selectEndOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        if (STOP_CLAUSE_AT_DEPTH_ZERO_REGEX.test(cleanSql.slice(i, blockEndOffset))) {
          itemSpans.push({ start: itemStart, end: i });
          itemStart = -1;
          break;
        }
      }
    }
  }

  if (itemStart !== -1 && itemStart < blockEndOffset) {
    itemSpans.push({ start: itemStart, end: blockEndOffset });
  }

  // 3. Extract the defined column identifier and its exact offset from each projection span
  for (const span of itemSpans) {
    const rawSlice = cleanSql.slice(span.start, span.end);
    if (!rawSlice.trim() || rawSlice.trim().endsWith('*')) {
      continue;
    }

    // Check for explicit `AS <alias>` at the end of the projection item
    const explicitAsMatch = /\bAS\s+([a-zA-Z0-9_]+)\s*$/i.exec(rawSlice);
    if (explicitAsMatch && explicitAsMatch[1]) {
      const aliasName = explicitAsMatch[1];
      const aliasStartInSlice =
        explicitAsMatch.index + explicitAsMatch[0].lastIndexOf(aliasName);
      const absStart = span.start + aliasStartInSlice;
      const absEnd = absStart + aliasName.length;

      locations.set(
        aliasName.toLowerCase(),
        offsetRangeToSourceLocation(sanitizedSql, filePath, absStart, absEnd)
      );
      continue;
    }

    // Otherwise strip any trailing Postgres/DuckDB `::TYPE` cast and match the trailing column identifier
    const withoutCast = rawSlice.replace(
      /::\s*[a-zA-Z0-9_]+(?:\s*\([^)]*\))?\s*$/,
      (m) => ' '.repeat(m.length)
    );

    const trailingIdMatch = /([a-zA-Z0-9_]+)\s*$/.exec(withoutCast);
    if (trailingIdMatch && trailingIdMatch[1]) {
      const colName = trailingIdMatch[1];
      const absStart = span.start + trailingIdMatch.index;
      const absEnd = absStart + colName.length;

      locations.set(
        colName.toLowerCase(),
        offsetRangeToSourceLocation(sanitizedSql, filePath, absStart, absEnd)
      );
    }
  }

  return locations;
}

/**
 * Extracts the identifier token under the cursor and its syntactic surroundings for Go-to-Definition.
 */
export function extractCursorTokenForDefinition(
  sanitizedSql: string,
  cursorOffset: number
): CursorDefinitionToken | null {
  const len = sanitizedSql.length;
  if (len === 0) return null;

  let probe = Math.max(0, Math.min(cursorOffset, len));
  // If cursor is at the exact end of an identifier, step back 1 char
  if (
    probe > 0 &&
    (probe === len || !/[a-zA-Z0-9_]/.test(sanitizedSql[probe] ?? '')) &&
    /[a-zA-Z0-9_]/.test(sanitizedSql[probe - 1] ?? '')
  ) {
    probe--;
  }

  if (!/[a-zA-Z0-9_]/.test(sanitizedSql[probe] ?? '')) {
    return null;
  }

  let start = probe;
  while (start > 0 && /[a-zA-Z0-9_]/.test(sanitizedSql[start - 1] ?? '')) {
    start--;
  }

  let end = probe + 1;
  while (end < len && /[a-zA-Z0-9_]/.test(sanitizedSql[end] ?? '')) {
    end++;
  }

  const word = sanitizedSql.slice(start, end);
  const beforeWord = sanitizedSql.slice(0, start);
  const afterWord = sanitizedSql.slice(end);

  const dotBeforeMatch = /([a-zA-Z0-9_]+)\.\s*$/.exec(beforeWord);
  const qualifier = dotBeforeMatch?.[1];
  const isQualifierBeforeDot = /^\s*\./.test(afterWord);
  const isAfterFromOrJoin =
    /\b(?:FROM|JOIN)\s+(?:[a-zA-Z0-9_]+\s+(?:AS\s+)?)?$/i.test(beforeWord);

  return {
    word,
    qualifier,
    isQualifierBeforeDot,
    isAfterFromOrJoin,
    startOffset: start,
    endOffset: end,
  };
}

// À ajouter à la fin de src/core/parser/sqlLocationFinder.ts :

const SQL_CLAUSE_RESERVED_WORDS = new Set([
  'on',
  'using',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'qualify',
  'window',
  'union',
  'except',
  'intersect',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'outer',
  'lateral',
  'as',
]);

/**
 * Locates the exact SourceLocation of table aliases (or unaliased table names)
 * declared in the FROM and JOIN clauses of the active query block [blockStartOffset, blockEndOffset].
 */
export function locateFromJoinAliases(
  sanitizedSql: string,
  filePath: string,
  blockStartOffset: number,
  blockEndOffset: number,
  relations: Map<string, DbtRelationToken>
): Map<string, SourceLocation> {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const aliasLocations = new Map<string, SourceLocation>();

  let depth = 0;
  let i = blockStartOffset;
  const limit = Math.min(blockEndOffset, cleanSql.length);

  while (i < limit) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      const prevChar = i > blockStartOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        const slice = cleanSql.slice(i, limit);
        const clauseMatch =
          /^(?:FROM|JOIN)\s+([a-zA-Z0-9_]+)(?:[ \t\r\n]+(?:AS[ \t\r\n]+)?([a-zA-Z0-9_]+))?/i.exec(
            slice
          );

        if (clauseMatch && clauseMatch[1]) {
          const rawTableToken = clauseMatch[1];
          const rawCandidateAlias = clauseMatch[2];

          const tableStartInSlice = clauseMatch[0].indexOf(rawTableToken);
          const absTableStart = i + tableStartInSlice;
          const absTableEnd = absTableStart + rawTableToken.length;

          const dbtRel = relations.get(rawTableToken.toLowerCase());
          const canonicalTableName = (
            dbtRel?.modelOrTableName ?? rawTableToken
          ).toLowerCase();

          const hasValidAlias =
            Boolean(rawCandidateAlias) &&
            !SQL_CLAUSE_RESERVED_WORDS.has(rawCandidateAlias!.toLowerCase());

          if (hasValidAlias && rawCandidateAlias) {
            const aliasStartInSlice = clauseMatch[0].lastIndexOf(rawCandidateAlias);
            const absAliasStart = i + aliasStartInSlice;
            const absAliasEnd = absAliasStart + rawCandidateAlias.length;

            const aliasLoc = offsetRangeToSourceLocation(
              sanitizedSql,
              filePath,
              absAliasStart,
              absAliasEnd
            );
            aliasLocations.set(rawCandidateAlias.toLowerCase(), aliasLoc);
            aliasLocations.set(canonicalTableName, aliasLoc);
          } else {
            const tableLoc = offsetRangeToSourceLocation(
              sanitizedSql,
              filePath,
              absTableStart,
              absTableEnd
            );
            aliasLocations.set(canonicalTableName, tableLoc);
          }

          i += clauseMatch[0].length;
          continue;
        }
      }
    }

    i++;
  }

  return aliasLocations;
}