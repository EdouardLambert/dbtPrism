// src/core/parser/jinjaSanitizer.ts

import {
  DbtRelationToken,
  RelationMaterialization,
  SanitizedSqlResult,
} from '../types.js';

const JINJA_BLOCK_REGEX = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})/g;
const REF_CALL_REGEX = /ref\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?\s*\)/;
const SOURCE_CALL_REGEX = /source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/;
const CONFIG_MATERIALIZED_REGEX =
  /config\([\s\S]*?materialized\s*=\s*['"]([a-zA-Z0-9_]+)['"][\s\S]*?\)/;

/**
 * Replaces Jinja blocks with valid SQL identifiers or whitespace of the exact same byte length
 * so character offsets and line/column coordinates remain 100% identical.
 */
export function sanitizeJinjaSql(rawSql: string): SanitizedSqlResult {
  const relations = new Map<string, DbtRelationToken>();
  let tokenCounter = 0;
  let materialized: RelationMaterialization | undefined;

  const sanitizedSql = rawSql.replace(JINJA_BLOCK_REGEX, (match, _group, offset: number) => {
    if (match.startsWith('{{')) {
      // 1. Check for {{ config(... materialized='...' ...) }}
      const configMatch = CONFIG_MATERIALIZED_REGEX.exec(match);
      if (configMatch && configMatch[1]) {
        materialized = normalizeMaterialization(configMatch[1]);
      }

      // 2. Check if it is a {{ ref(...) }} expression
      const refMatch = REF_CALL_REGEX.exec(match);
      if (refMatch) {
        const modelName = refMatch[2] ?? refMatch[1] ?? '';
        const syntheticId = buildLengthPreservingIdentifier(`_r${tokenCounter++}_`, match);

        relations.set(syntheticId.toLowerCase(), {
          syntheticId: syntheticId.toLowerCase(),
          type: 'ref',
          modelOrTableName: modelName,
          startOffset: offset,
          endOffset: offset + match.length,
        });

        return syntheticId;
      }

      // 3. Check if it is a {{ source(...) }} expression
      const sourceMatch = SOURCE_CALL_REGEX.exec(match);
      if (sourceMatch) {
        const sourceName = sourceMatch[1] ?? '';
        const tableName = sourceMatch[2] ?? '';
        const syntheticId = buildLengthPreservingIdentifier(`_s${tokenCounter++}_`, match);

        relations.set(syntheticId.toLowerCase(), {
          syntheticId: syntheticId.toLowerCase(),
          type: 'source',
          sourceName,
          modelOrTableName: tableName,
          startOffset: offset,
          endOffset: offset + match.length,
        });

        return syntheticId;
      }
    }

    return maskWithWhitespace(match);
  });

  return { sanitizedSql, relations, materialized };
}

export function normalizeMaterialization(raw?: string): RelationMaterialization | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (
    lower === 'table' ||
    lower === 'view' ||
    lower === 'incremental' ||
    lower === 'ephemeral' ||
    lower === 'snapshot'
  ) {
    return lower;
  }
  return 'model';
}

function buildLengthPreservingIdentifier(prefix: string, originalMatch: string): string {
  const totalLength = originalMatch.length;
  if (prefix.length >= totalLength) {
    return prefix.slice(0, totalLength);
  }
  return prefix.padEnd(totalLength, '_');
}

function maskWithWhitespace(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}