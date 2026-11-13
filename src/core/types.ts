// src/core/types.ts

export type ColumnSourceOrigin = 'schema_yml' | 'sql_inferred' | 'cte_local';

export type RelationMaterialization =
  | 'table'
  | 'view'
  | 'incremental'
  | 'ephemeral'
  | 'cte'
  | 'snapshot'
  | 'source'
  | 'model';

export interface SourceLocation {
  filePath: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

export interface ColumnMetadata {
  name: string;
  dataType?: string;
  description?: string;
  origin: ColumnSourceOrigin;
  sourceModelName?: string;
  sourceKind?: RelationMaterialization;
  constraints?: string[];
  dataTests?: string[];
  definitionLocation?: SourceLocation;
}

export interface ModelDescriptor {
  name: string;
  filePath: string;
  materialized: RelationMaterialization;
  description?: string;
  columns: Map<string, ColumnMetadata>;
  refs: string[];
  lastUpdated: number;
}

export interface DbtRelationToken {
  syntheticId: string;
  type: 'ref' | 'source';
  modelOrTableName: string;
  sourceName?: string;
  startOffset: number;
  endOffset: number;
}

export interface SanitizedSqlResult {
  sanitizedSql: string;
  relations: Map<string, DbtRelationToken>;
  materialized?: RelationMaterialization;
}

export type CursorIntentType =
  | 'DOT_COMPLETION'
  | 'UNQUALIFIED_COLUMN'
  | 'TABLE_OR_MODEL'
  | 'DBT_REF_ARGUMENT'
  | 'UNKNOWN';

export interface HealedSqlContext {
  healedSql: string;
  intent: CursorIntentType;
  qualifier?: string;
  prefix: string;
  cursorOffset: number;
}

export interface CompletionCandidate {
  label: string;
  insertText: string;
  kind: 'column' | 'model' | 'cte';
  dataType?: string;
  sourceName?: string;
  sourceKind?: RelationMaterialization;
  detail?: string;
  documentation?: string;
  constraints?: string[];
  dataTests?: string[];
  sortPriority: number;
}

export interface MetadataRegistryPort {
  getModel(modelName: string): ModelDescriptor | undefined;
  getAllModels(): ModelDescriptor[];
}

export type TableDefinitionTargetMode = 'from_alias' | 'source_model';

export interface DefinitionOptions {
  tableTargetMode?: TableDefinitionTargetMode;
}

export interface HoverResult {
  candidate: CompletionCandidate;
  startOffset: number;
  endOffset: number;
}