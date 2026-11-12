// src/core/analyzer/sqlScopeAnalyzer.ts

import NodeSqlParser from 'node-sql-parser';
import {
  ColumnMetadata,
  CompletionCandidate,
  DbtRelationToken,
  MetadataRegistryPort,
  RelationMaterialization,
} from '../types.js';
import { sanitizeJinjaSql } from '../parser/jinjaSanitizer.js';
import { CURSOR_SYNTHETIC_TOKEN, healSqlAtCursor } from '../parser/cursorHealer.js';

const { Parser } = NodeSqlParser;

interface ScopedRelation {
  aliasOrName: string;
  targetName: string;
  sourceKind: RelationMaterialization;
  columns: ColumnMetadata[];
}

export class SqlScopeAnalyzer {
  private readonly parser = new Parser();

  constructor(private readonly registry: MetadataRegistryPort) {}

  /**
   * Statically infers the output columns, materialization, and upstream dbt refs of a model SQL file.
   */
  public inferModelColumns(
    rawSql: string,
    modelName: string,
    defaultMaterialized: RelationMaterialization = 'view'
  ): {
    columns: ColumnMetadata[];
    refs: string[];
    materialized: RelationMaterialization;
  } {
    const { sanitizedSql, relations, materialized } = sanitizeJinjaSql(rawSql);
    const effectiveMaterialized = materialized ?? defaultMaterialized;

    const refs = Array.from(relations.values())
      .filter((r) => r.type === 'ref')
      .map((r) => r.modelOrTableName);

    const ast = this.tryParseAst(sanitizedSql);
    if (!ast) {
      return { columns: [], refs, materialized: effectiveMaterialized };
    }

    const cteMap = this.extractLocalCtes(ast, relations);
    const scopedRelations = this.resolveScopedRelations(ast, cteMap, relations);
    const columns = this.extractProjectedColumns(
      ast,
      scopedRelations,
      modelName,
      effectiveMaterialized,
      'sql_inferred'
    );

    return { columns, refs, materialized: effectiveMaterialized };
  }

  public computeCompletions(rawSql: string, cursorOffset: number): CompletionCandidate[] {
    const { sanitizedSql, relations } = sanitizeJinjaSql(rawSql);
    const healed = healSqlAtCursor(rawSql, sanitizedSql, cursorOffset);

    if (healed.intent === 'DBT_REF_ARGUMENT') {
      return this.buildModelRefCompletions(healed.prefix, false);
    }

    const ast = this.tryParseAst(healed.healedSql);
    if (!ast) {
      return [];
    }

    const cteMap = this.extractLocalCtes(ast, relations);

    if (healed.intent === 'TABLE_OR_MODEL') {
      return this.buildTableOrModelCompletions(healed.prefix, cteMap);
    }

    const activeSelectAst = this.findSelectContainingCursor(ast) ?? ast;
    const activeRelations = this.resolveScopedRelations(activeSelectAst, cteMap, relations);

    if (healed.intent === 'DOT_COMPLETION' && healed.qualifier) {
      return this.buildDotCompletions(healed.qualifier, healed.prefix, activeRelations);
    }

    if (healed.intent === 'UNQUALIFIED_COLUMN') {
      return this.buildContextualColumnCompletions(healed.prefix, activeRelations);
    }

    return [];
  }

  private tryParseAst(sql: string): any | null {
    try {
      const parsed = this.parser.astify(sql, { database: 'PostgresQL' });
      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      return null;
    }
  }

  private unwrapIdentifier(node: any): string | undefined {
    if (!node) return undefined;
    if (typeof node === 'string') return node;
    if (typeof node.value === 'string') return node.value;
    if (typeof node.expr?.value === 'string') return node.expr.value;
    if (typeof node.table === 'string') return node.table;
    if (typeof node.column === 'string') return node.column;
    return undefined;
  }

  private inferExpressionDataType(expr: any): string | undefined {
    if (!expr) return undefined;

    // 1. Explicit CAST(x AS TYPE) or x::TYPE
    if (expr.type === 'cast') {
      const target = Array.isArray(expr.target) ? expr.target[0] : expr.target;
      if (typeof target?.dataType === 'string') {
        return target.dataType.toUpperCase();
      }
    }

    // 2. Aggregate functions (COUNT -> BIGINT, SUM/AVG -> NUMERIC)
    if (expr.type === 'aggr_func' && typeof expr.name === 'string') {
      const funcName = expr.name.toUpperCase();
      if (funcName === 'COUNT') return 'BIGINT';
      if (funcName === 'SUM' || funcName === 'AVG') return 'NUMERIC';
    }

    // 3. Binary arithmetic expressions (e.g. amount_cents / 100.0)
    if (expr.type === 'binary_expr' && ['/', '*', '+', '-'].includes(expr.operator)) {
      return 'NUMERIC';
    }

    return undefined;
  }

  private extractLocalCtes(
    rootAst: any,
    relations: Map<string, DbtRelationToken>
  ): Map<string, ColumnMetadata[]> {
    const cteColumns = new Map<string, ColumnMetadata[]>();
    const withClause: any[] | undefined = rootAst?.with;

    if (!Array.isArray(withClause)) {
      return cteColumns;
    }

    for (const cteDef of withClause) {
      const cteName = this.unwrapIdentifier(cteDef?.name);
      const cteStmt = cteDef?.stmt?.ast ?? cteDef?.stmt;
      if (!cteName || !cteStmt) continue;

      const scopedParents = this.resolveScopedRelations(cteStmt, cteColumns, relations);
      const projected = this.extractProjectedColumns(
        cteStmt,
        scopedParents,
        cteName,
        'cte',
        'cte_local'
      );
      cteColumns.set(cteName.toLowerCase(), projected);
    }

    return cteColumns;
  }

  private extractProjectedColumns(
    selectAst: any,
    scopedRelations: Map<string, ScopedRelation>,
    currentScopeName: string,
    currentScopeKind: RelationMaterialization = 'cte',
    defaultOrigin: 'cte_local' | 'sql_inferred' = 'cte_local'
  ): ColumnMetadata[] {
    const result: ColumnMetadata[] = [];
    const columns = selectAst?.columns;
    if (!Array.isArray(columns)) return result;

    for (const colItem of columns) {
      const expr = colItem?.expr ?? colItem;
      if (!expr) continue;

      const rawColumnName =
        this.unwrapIdentifier(expr.column) ??
        (expr.type === 'cast' ? this.unwrapIdentifier(expr.expr?.column) : undefined);

      if (rawColumnName === CURSOR_SYNTHETIC_TOKEN) continue;

      const tableQual = this.unwrapIdentifier(expr.table)?.toLowerCase();

      // Handle SELECT * or SELECT alias.*
      if (rawColumnName === '*') {
        const starSourceCols: ColumnMetadata[] = [];
        if (tableQual) {
          const targetRel = scopedRelations.get(tableQual);
          if (targetRel) starSourceCols.push(...targetRel.columns);
        } else {
          for (const rel of scopedRelations.values()) {
            starSourceCols.push(...rel.columns);
          }
        }

        // Preserve rich metadata (type, doc, constraints, tests) but bind source to current scope
        for (const upstreamCol of starSourceCols) {
          result.push({
            ...upstreamCol,
            sourceModelName: currentScopeName,
            sourceKind: currentScopeKind,
          });
        }
        continue;
      }

      const explicitAlias = this.unwrapIdentifier(colItem.as);
      const effectiveName = explicitAlias ?? rawColumnName;
      if (!effectiveName) continue;

      let upstreamMeta: ColumnMetadata | undefined;
      if (rawColumnName) {
        if (tableQual && scopedRelations.has(tableQual)) {
          upstreamMeta = scopedRelations
            .get(tableQual)
            ?.columns.find((c) => c.name.toLowerCase() === rawColumnName.toLowerCase());
        } else {
          for (const rel of scopedRelations.values()) {
            const found = rel.columns.find(
              (c) => c.name.toLowerCase() === rawColumnName.toLowerCase()
            );
            if (found) {
              upstreamMeta = found;
              break;
            }
          }
        }
      }

      const inferredExprType = this.inferExpressionDataType(expr);

      result.push({
        name: effectiveName,
        dataType: inferredExprType ?? upstreamMeta?.dataType,
        description: upstreamMeta?.description,
        origin: upstreamMeta?.origin ?? defaultOrigin,
        sourceModelName: currentScopeName,
        sourceKind: currentScopeKind,
        constraints: upstreamMeta?.constraints,
        dataTests: upstreamMeta?.dataTests,
      });
    }

    return result;
  }

  private resolveScopedRelations(
    selectAst: any,
    cteMap: Map<string, ColumnMetadata[]>,
    relations: Map<string, DbtRelationToken>
  ): Map<string, ScopedRelation> {
    const scoped = new Map<string, ScopedRelation>();
    const fromList: any[] | undefined = selectAst?.from;
    if (!Array.isArray(fromList)) return scoped;

    for (const fromEntry of fromList) {
      const rawTableName = this.unwrapIdentifier(fromEntry?.table);
      if (!rawTableName || rawTableName === CURSOR_SYNTHETIC_TOKEN) continue;

      const lowerTable = rawTableName.toLowerCase();
      const explicitAlias = this.unwrapIdentifier(fromEntry?.as);

      // 1. Check if it corresponds to a sanitized {{ ref('...') }} or {{ source('...') }}
      const dbtRel = relations.get(lowerTable);
      if (dbtRel) {
        const modelDesc = this.registry.getModel(dbtRel.modelOrTableName);
        const relKind: RelationMaterialization =
          modelDesc?.materialized ?? (dbtRel.type === 'source' ? 'source' : 'model');

        const cols = modelDesc ? Array.from(modelDesc.columns.values()) : [];
        const effectiveAlias = (explicitAlias ?? dbtRel.modelOrTableName).toLowerCase();

        scoped.set(effectiveAlias, {
          aliasOrName: explicitAlias ?? dbtRel.modelOrTableName,
          targetName: dbtRel.modelOrTableName,
          sourceKind: relKind,
          columns: cols,
        });
        continue;
      }

      // 2. Check if it corresponds to a local CTE
      const cteCols = cteMap.get(lowerTable);
      if (cteCols) {
        const effectiveAlias = (explicitAlias ?? rawTableName).toLowerCase();
        scoped.set(effectiveAlias, {
          aliasOrName: explicitAlias ?? rawTableName,
          targetName: rawTableName,
          sourceKind: 'cte',
          columns: cteCols,
        });
        continue;
      }

      // 3. Fallback: direct table name matching a registered model
      const directModel = this.registry.getModel(rawTableName);
      if (directModel) {
        const effectiveAlias = (explicitAlias ?? rawTableName).toLowerCase();
        const relKind: RelationMaterialization = directModel.materialized ?? 'model';

        scoped.set(effectiveAlias, {
          aliasOrName: explicitAlias ?? rawTableName,
          targetName: directModel.name,
          sourceKind: relKind,
          columns: Array.from(directModel.columns.values()),
        });
      }
    }

    return scoped;
  }

  private buildDotCompletions(
    qualifier: string,
    prefix: string,
    activeRelations: Map<string, ScopedRelation>
  ): CompletionCandidate[] {
    const targetRelation = activeRelations.get(qualifier.toLowerCase());
    if (!targetRelation) return [];

    const lowerPrefix = prefix.toLowerCase();
    return targetRelation.columns
      .filter((col) => col.name.toLowerCase().startsWith(lowerPrefix))
      .map((col, idx) => this.createColumnCandidate(col, col.name, col.name, targetRelation, idx));
  }

  private buildContextualColumnCompletions(
    prefix: string,
    activeRelations: Map<string, ScopedRelation>
  ): CompletionCandidate[] {
    const lowerPrefix = prefix.toLowerCase();
    const isMultiTableScope = activeRelations.size > 1;
    const candidates: CompletionCandidate[] = [];

    let tablePriority = 0;
    let aliasMatchedColPriority = 100;
    let otherColPriority = 500;

    // 1. Tier 1 (Highest Priority): Propose matching scoped tables / aliases first (e.g. "cus")
    for (const rel of activeRelations.values()) {
      const aliasMatches = rel.aliasOrName.toLowerCase().startsWith(lowerPrefix);
      const targetMatches = rel.targetName.toLowerCase().startsWith(lowerPrefix);

      if (aliasMatches || targetMatches) {
        candidates.push({
          label: rel.aliasOrName,
          insertText: rel.aliasOrName,
          kind: rel.sourceKind === 'cte' ? 'cte' : 'model',
          sourceName: rel.targetName,
          sourceKind: rel.sourceKind,
          detail: `${rel.targetName} (${rel.sourceKind})`,
          sortPriority: tablePriority++,
        });
      }
    }

    // 2. Tier 2 & 3: Propose matching columns (prioritizing columns from matching table alias)
    for (const rel of activeRelations.values()) {
      const aliasStartsWithPrefix =
        lowerPrefix.length > 0 && rel.aliasOrName.toLowerCase().startsWith(lowerPrefix);

      for (const col of rel.columns) {
        if (!col.name.toLowerCase().startsWith(lowerPrefix)) continue;

        const qualifiedText = `${rel.aliasOrName}.${col.name}`;
        const labelAndInsert = isMultiTableScope ? qualifiedText : col.name;
        const priority = aliasStartsWithPrefix
          ? aliasMatchedColPriority++
          : otherColPriority++;

        candidates.push(
          this.createColumnCandidate(col, labelAndInsert, labelAndInsert, rel, priority)
        );
      }
    }

    return candidates.sort((a, b) => a.sortPriority - b.sortPriority);
  }

  private createColumnCandidate(
    col: ColumnMetadata,
    label: string,
    insertText: string,
    relation: ScopedRelation,
    sortPriority: number
  ): CompletionCandidate {
    // Always use the direct relation being queried as the displayed source
    const sourceName = relation.targetName;
    const sourceKind = relation.sourceKind;

    return {
      label,
      insertText,
      kind: 'column',
      dataType: col.dataType,
      sourceName,
      sourceKind,
      detail: this.formatColumnDetail(col, sourceName, sourceKind),
      documentation: col.description,
      constraints: col.constraints,
      dataTests: col.dataTests,
      sortPriority,
    };
  }

  private buildTableOrModelCompletions(
    prefix: string,
    cteMap: Map<string, ColumnMetadata[]>
  ): CompletionCandidate[] {
    const lowerPrefix = prefix.toLowerCase();
    const candidates: CompletionCandidate[] = [];

    for (const cteName of cteMap.keys()) {
      if (cteName.startsWith(lowerPrefix)) {
        candidates.push({
          label: cteName,
          insertText: cteName,
          kind: 'cte',
          sourceName: cteName,
          sourceKind: 'cte',
          detail: `${cteName} (cte)`,
          sortPriority: 1,
        });
      }
    }

    candidates.push(...this.buildModelRefCompletions(prefix, true));
    return candidates;
  }

  private buildModelRefCompletions(
    prefix: string,
    wrapWithJinjaRef: boolean
  ): CompletionCandidate[] {
    const lowerPrefix = prefix.toLowerCase();
    return this.registry
      .getAllModels()
      .filter((m) => m.name.toLowerCase().startsWith(lowerPrefix))
      .map((m) => ({
        label: m.name,
        insertText: wrapWithJinjaRef ? `{{ ref('${m.name}') }} as ${m.name}` : m.name,
        kind: 'model' as const,
        sourceName: m.name,
        sourceKind: m.materialized ?? 'model',
        detail: `${m.name} (${m.materialized ?? 'model'})`,
        sortPriority: 2,
      }));
  }

  private findSelectContainingCursor(astNode: any): any | null {
    if (!astNode || typeof astNode !== 'object') return null;

    const serialized = JSON.stringify(astNode);
    if (!serialized.includes(CURSOR_SYNTHETIC_TOKEN)) return null;

    if (Array.isArray(astNode.with)) {
      for (const cte of astNode.with) {
        const cteAst = cte?.stmt?.ast ?? cte?.stmt;
        if (cteAst && JSON.stringify(cteAst).includes(CURSOR_SYNTHETIC_TOKEN)) {
          return cteAst;
        }
      }
    }

    return astNode;
  }

  private formatColumnDetail(
    col: ColumnMetadata,
    sourceName: string,
    sourceKind: RelationMaterialization
  ): string {
    const formattedSource = `${sourceName} (${sourceKind})`;
    return col.dataType ? `${col.dataType} • ${formattedSource}` : formattedSource;
  }
}