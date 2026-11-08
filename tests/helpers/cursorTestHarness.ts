// tests/helpers/cursorTestHarness.ts

import { MetadataRegistryPort, ModelDescriptor } from '../../src/core/types.js';

export function extractCursor(sqlWithCursorMarker: string): {
  sql: string;
  cursorOffset: number;
} {
  const cursorOffset = sqlWithCursorMarker.indexOf('|');
  if (cursorOffset === -1) {
    throw new Error('Test SQL string must contain a "|" cursor marker.');
  }
  const sql =
    sqlWithCursorMarker.slice(0, cursorOffset) +
    sqlWithCursorMarker.slice(cursorOffset + 1);
  return { sql, cursorOffset };
}

export class InMemoryMetadataRegistry implements MetadataRegistryPort {
  private readonly models = new Map<string, ModelDescriptor>();

  public registerModel(model: ModelDescriptor): void {
    this.models.set(model.name.toLowerCase(), model);
  }

  public getModel(modelName: string): ModelDescriptor | undefined {
    return this.models.get(modelName.toLowerCase());
  }

  public getAllModels(): ModelDescriptor[] {
    return Array.from(this.models.values());
  }
}