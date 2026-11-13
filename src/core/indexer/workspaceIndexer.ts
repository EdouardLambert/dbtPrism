// src/core/indexer/workspaceIndexer.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import fg from 'fast-glob';
import {
  ColumnMetadata,
  MetadataRegistryPort,
  ModelDescriptor,
  RelationMaterialization,
} from '../types.js';
import { parseDbtSchemaYaml } from './schemaYamlParser.js';
import { SqlScopeAnalyzer } from '../analyzer/sqlScopeAnalyzer.js';
import { sanitizeJinjaSql } from '../parser/jinjaSanitizer.js';

interface RawSqlModelFile {
  modelName: string;
  filePath: string;
  rawSql: string;
  refs: string[];
  materialized?: RelationMaterialization;
}

export class WorkspaceIndexer implements MetadataRegistryPort {
  private readonly models = new Map<string, ModelDescriptor>();
  private readonly yamlSchemas = new Map<string, Map<string, ColumnMetadata>>();
  private readonly yamlMaterializations = new Map<string, RelationMaterialization>();
  private readonly rawSqlModels = new Map<string, RawSqlModelFile>();
  private readonly analyzer: SqlScopeAnalyzer;

  constructor() {
    this.analyzer = new SqlScopeAnalyzer(this);
  }

  public getModel(modelName: string): ModelDescriptor | undefined {
    return this.models.get(modelName.toLowerCase());
  }

  public getAllModels(): ModelDescriptor[] {
    return Array.from(this.models.values());
  }

  public async indexWorkspaceFolder(rootDir: string): Promise<void> {
    const normalizedRoot = rootDir.replace(/\\/g, '/');

    const [yamlFiles, sqlFiles] = await Promise.all([
      fg(['**/models/**/*.{yml,yaml}', '**/snapshots/**/*.{yml,yaml}'], {
        cwd: normalizedRoot,
        absolute: true,
        ignore: ['**/target/**', '**/dbt_packages/**', '**/node_modules/**', '**/.git/**'],
      }),
      fg(['**/models/**/*.sql', '**/snapshots/**/*.sql'], {
        cwd: normalizedRoot,
        absolute: true,
        ignore: ['**/target/**', '**/dbt_packages/**', '**/node_modules/**', '**/.git/**'],
      }),
    ]);

    for (const ymlPath of yamlFiles) {
      await this.loadYamlFile(ymlPath);
    }

    for (const sqlPath of sqlFiles) {
      await this.loadSqlFile(sqlPath);
    }

    this.rebuildAllModelsTopologically();
  }

  public async updateFile(filePath: string): Promise<void> {
    if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
      await this.loadYamlFile(filePath);
    } else if (filePath.endsWith('.sql')) {
      await this.loadSqlFile(filePath);
    }
    this.rebuildAllModelsTopologically();
  }

  private async loadYamlFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsedModels = parseDbtSchemaYaml(content);
      for (const parsed of parsedModels) {
        const key = parsed.modelName.toLowerCase();
        if (parsed.materialized) {
          this.yamlMaterializations.set(key, parsed.materialized);
        }
        const existing = this.yamlSchemas.get(key) ?? new Map<string, ColumnMetadata>();
        for (const [colKey, colMeta] of parsed.columns.entries()) {
          existing.set(colKey, colMeta);
        }
        this.yamlSchemas.set(key, existing);
      }
    } catch {
      // Ignore unreadable files
    }
  }

  private async loadSqlFile(filePath: string): Promise<void> {
    try {
      const rawSql = await fs.readFile(filePath, 'utf-8');
      const modelName = path.basename(filePath, '.sql');
      const isSnapshot = filePath.replace(/\\/g, '/').includes('/snapshots/');
      const { relations, materialized } = sanitizeJinjaSql(rawSql);
      const refs = Array.from(relations.values())
        .filter((r) => r.type === 'ref')
        .map((r) => r.modelOrTableName);

      this.rawSqlModels.set(modelName.toLowerCase(), {
        modelName,
        filePath,
        rawSql,
        refs,
        materialized: isSnapshot ? 'snapshot' : materialized,
      });
    } catch {
      // Ignore unreadable files
    }
  }

  private rebuildAllModelsTopologically(): void {
    const sortedSqlModels = this.topologicalSortModels(Array.from(this.rawSqlModels.values()));

    for (const sqlModel of sortedSqlModels) {
      const key = sqlModel.modelName.toLowerCase();
      const defaultMat =
        sqlModel.materialized ?? this.yamlMaterializations.get(key) ?? 'view';

      const {
        columns: inferredCols,
        refs,
        materialized,
      } = this.analyzer.inferModelColumns(
        sqlModel.rawSql,
        sqlModel.modelName,
        defaultMat,
        sqlModel.filePath
      );

      const yamlCols = this.yamlSchemas.get(key);
      const mergedColumns = this.mergeColumns(
        sqlModel.modelName,
        inferredCols,
        yamlCols,
        materialized
      );

      this.models.set(key, {
        name: sqlModel.modelName,
        filePath: sqlModel.filePath,
        materialized,
        columns: mergedColumns,
        refs,
        lastUpdated: Date.now(),
      });
    }

    for (const [key, yamlCols] of this.yamlSchemas.entries()) {
      if (!this.models.has(key)) {
        const firstCol = Array.from(yamlCols.values())[0];
        const canonicalName = firstCol?.sourceModelName ?? key;
        const materialized = this.yamlMaterializations.get(key) ?? 'model';

        this.models.set(key, {
          name: canonicalName,
          filePath: '',
          materialized,
          columns: new Map(yamlCols),
          refs: [],
          lastUpdated: Date.now(),
        });
      }
    }
  }

  private mergeColumns(
    modelName: string,
    inferredCols: ColumnMetadata[],
    yamlCols: Map<string, ColumnMetadata> | undefined,
    modelMaterialized: RelationMaterialization
  ): Map<string, ColumnMetadata> {
    const merged = new Map<string, ColumnMetadata>();

    for (const sqlCol of inferredCols) {
      const colKey = sqlCol.name.toLowerCase();
      const ymlCol = yamlCols?.get(colKey);

      if (ymlCol) {
        merged.set(colKey, {
          name: sqlCol.name,
          dataType: ymlCol.dataType ?? sqlCol.dataType,
          description: ymlCol.description ?? sqlCol.description,
          origin: 'schema_yml',
          sourceModelName: modelName,
          sourceKind: modelMaterialized,
          constraints: ymlCol.constraints ?? sqlCol.constraints,
          dataTests: ymlCol.dataTests ?? sqlCol.dataTests,
          definitionLocation: sqlCol.definitionLocation ?? ymlCol.definitionLocation,
        });
      } else {
        merged.set(colKey, {
          ...sqlCol,
          sourceModelName: modelName,
          sourceKind: modelMaterialized,
        });
      }
    }

    if (yamlCols) {
      for (const [colKey, ymlCol] of yamlCols.entries()) {
        if (!merged.has(colKey)) {
          merged.set(colKey, {
            ...ymlCol,
            sourceModelName: modelName,
            sourceKind: modelMaterialized,
          });
        }
      }
    }

    return merged;
  }

  private topologicalSortModels(models: RawSqlModelFile[]): RawSqlModelFile[] {
    const byName = new Map<string, RawSqlModelFile>();
    for (const m of models) {
      byName.set(m.modelName.toLowerCase(), m);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: RawSqlModelFile[] = [];

    const visit = (modelKey: string) => {
      if (visited.has(modelKey) || visiting.has(modelKey)) return;
      visiting.add(modelKey);

      const current = byName.get(modelKey);
      if (current) {
        for (const refName of current.refs) {
          visit(refName.toLowerCase());
        }
        sorted.push(current);
      }

      visiting.delete(modelKey);
      visited.add(modelKey);
    };

    for (const key of byName.keys()) {
      visit(key);
    }

    return sorted;
  }
}