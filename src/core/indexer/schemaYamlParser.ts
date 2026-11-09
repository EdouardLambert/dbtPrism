// src/core/indexer/schemaYamlParser.ts

import { parse as parseYaml } from 'yaml';
import { ColumnMetadata, RelationMaterialization } from '../types.js';
import { normalizeMaterialization } from '../parser/jinjaSanitizer.js';

export interface ParsedYamlModelSchema {
  modelName: string;
  description?: string;
  materialized?: RelationMaterialization;
  columns: Map<string, ColumnMetadata>;
}

/**
 * Parses a dbt schema.yml content string and extracts documented models, columns,
 * constraints, and data_tests.
 */
export function parseDbtSchemaYaml(yamlContent: string): ParsedYamlModelSchema[] {
  let doc: any;
  try {
    doc = parseYaml(yamlContent);
  } catch {
    return [];
  }

  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.models)) {
    return [];
  }

  const results: ParsedYamlModelSchema[] = [];

  for (const modelEntry of doc.models) {
    if (!modelEntry || typeof modelEntry.name !== 'string') continue;

    const modelName = modelEntry.name.trim();
    const materialized = normalizeMaterialization(modelEntry.config?.materialized);
    const columns = new Map<string, ColumnMetadata>();

    if (Array.isArray(modelEntry.columns)) {
      for (const colEntry of modelEntry.columns) {
        if (!colEntry || typeof colEntry.name !== 'string') continue;

        const colName = colEntry.name.trim();
        const rawType = colEntry.data_type ?? colEntry.type;
        const dataType = typeof rawType === 'string' ? rawType.toUpperCase() : undefined;
        const description =
          typeof colEntry.description === 'string' ? colEntry.description.trim() : undefined;

        const constraints = extractConstraints(colEntry.constraints);
        const rawTests = colEntry.data_tests ?? colEntry.tests;
        const dataTests = extractDataTests(rawTests);

        columns.set(colName.toLowerCase(), {
          name: colName,
          dataType,
          description,
          origin: 'schema_yml',
          sourceModelName: modelName,
          sourceKind: materialized,
          constraints: constraints.length > 0 ? constraints : undefined,
          dataTests: dataTests.length > 0 ? dataTests : undefined,
        });
      }
    }

    results.push({
      modelName,
      description: typeof modelEntry.description === 'string' ? modelEntry.description : undefined,
      materialized,
      columns,
    });
  }

  return results;
}

/**
 * Strips `ref('model')` -> `model` and `source('src', 'tbl')` -> `src.tbl`
 * so relationship badges stay compact and readable.
 */
export function cleanDbtRelationTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();

  const refMatch = /^ref\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?\s*\)$/i.exec(trimmed);
  if (refMatch) {
    return refMatch[2] ? `${refMatch[1]}.${refMatch[2]}` : (refMatch[1] ?? trimmed);
  }

  const sourceMatch = /^source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/i.exec(trimmed);
  if (sourceMatch) {
    return `${sourceMatch[1]}.${sourceMatch[2]}`;
  }

  return trimmed;
}

function extractConstraints(rawConstraints: unknown): string[] {
  if (!Array.isArray(rawConstraints)) return [];
  const formatted: string[] = [];

  for (const item of rawConstraints) {
    if (typeof item === 'string') {
      formatted.push(item.trim());
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, any>;
      if (typeof obj.type === 'string') {
        if (obj.to && typeof obj.to === 'string') {
          const cleanTarget = cleanDbtRelationTarget(obj.to);
          const toCols =
            Array.isArray(obj.to_columns) && obj.to_columns.length > 0
              ? `.${obj.to_columns.join(',')}`
              : '';
          formatted.push(`${obj.type} -> ${cleanTarget}${toCols}`);
        } else if (obj.expression && typeof obj.expression === 'string') {
          formatted.push(`${obj.type} (${obj.expression})`);
        } else {
          formatted.push(obj.type);
        }
      }
    }
  }

  return formatted;
}

function extractDataTests(rawTests: unknown): string[] {
  if (!Array.isArray(rawTests)) return [];
  const formatted: string[] = [];

  for (const item of rawTests) {
    if (typeof item === 'string') {
      formatted.push(item.trim());
    } else if (item && typeof item === 'object') {
      const keys = Object.keys(item);
      for (const testName of keys) {
        const config = (item as Record<string, any>)[testName];
        if (testName === 'relationships' && config?.to) {
          const cleanTarget = cleanDbtRelationTarget(String(config.to));
          const field = config.field ? `.${String(config.field).trim()}` : '';
          formatted.push(`relationships -> ${cleanTarget}${field}`);
        } else if (testName === 'accepted_values' && Array.isArray(config?.values)) {
          formatted.push(`accepted_values [${config.values.join(', ')}]`);
        } else {
          formatted.push(testName);
        }
      }
    }
  }

  return formatted;
}