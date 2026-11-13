// src/core/analyzer/sqlScopeAnalyzer.ts

import NodeSqlParser from 'node-sql-parser';
import {
  ColumnMetadata,
  CompletionCandidate,
  DbtRelationToken,
  DefinitionOptions,
  MetadataRegistryPort,
  RelationMaterialization,
  SourceLocation,
} from '../types.js';
import { sanitizeJinjaSql } from '../parser/jinjaSanitizer.js';
import { CURSOR_SYNTHETIC_TOKEN, healSqlAtCursor } from '../parser/cursorHealer.js';
import {
  CteLocationBlock,
  extractCursorTokenForDefinition,
  locateCteDefinitions,
  locateFromJoinAliases,
  locateSelectProjectionColumns,
} from '../parser/sqlLocationFinder.js';

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
   * Statically infers the output columns, definition locations, materialization,
   * and upstream dbt refs of a model SQL file.
   */
  public inferModelColumns(
    rawSql: string,
    modelName: string,
    defaultMaterialized: RelationMaterialization = 'view',
    filePath = ''
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

    const cteLocations = locateCteDefinitions(sanitizedSql, filePath);
    const cteMap = this.extractLocalCtes(ast, relations, sanitizedSql, filePath, cteLocations);

    const mainQueryStartOffset = this.getMainQueryStartOffset(cteLocations);
    const mainProjectedLocations = filePath
      ? locateSelectProjectionColumns(
          sanitizedSql,
          filePath,
          mainQueryStartOffset,
          sanitizedSql.length
        )
      : new Map<string, SourceLocation>();

    const scopedRelations = this.resolveScopedRelations(ast, cteMap, relations);
    const columns = this.extractProjectedColumns(
      ast,
      scopedRelations,
      modelName,
      effectiveMaterialized,
      'sql_inferred',
      mainProjectedLocations
    );

    return { columns, refs, materialized: effectiveMaterialized };
  }

/**
   * Resolves the target SourceLocation for Go-to-Definition (Ctrl+Click / F12)
   * on a table, model ref(), CTE alias, or column.
   */
  public computeDefinition(
    rawSql: string,
    cursorOffset: number,
    currentFilePath = '',
    options: DefinitionOptions = {}
  ): SourceLocation | null {
    const tableTargetMode = options.tableTargetMode ?? 'from_alias';
    const { sanitizedSql, relations } = sanitizeJinjaSql(rawSql);

    // 1. Direct click inside {{ ref('model') }} or {{ source('src', 'table') }}
    for (const rel of relations.values()) {
      if (cursorOffset >= rel.startOffset && cursorOffset <= rel.endOffset) {
        return this.getModelFileStartLocation(rel.modelOrTableName);
      }
    }

    const token = extractCursorTokenForDefinition(sanitizedSql, cursorOffset);
    if (!token) return null;

    const ast =
      this.tryParseAst(sanitizedSql) ??
      this.tryParseAst(healSqlAtCursor(rawSql, sanitizedSql, cursorOffset).healedSql);
    if (!ast) return null;

    const cteLocations = locateCteDefinitions(sanitizedSql, currentFilePath);
    const cteMap = this.extractLocalCtes(
      ast,
      relations,
      sanitizedSql,
      currentFilePath,
      cteLocations
    );

    // 2. Check if clicking directly on a CTE name in `WITH cte_name AS (`
    const lowerWord = token.word.toLowerCase();
    const clickedCteBlock = cteLocations.get(lowerWord);
    if (
      clickedCteBlock &&
      cursorOffset >= token.startOffset &&
      token.startOffset < clickedCteBlock.bodyStartOffset
    ) {
      return clickedCteBlock.nameLocation;
    }

    // 3. Determine the active SELECT AST block and offset range at the cursor offset
    const activeSelectAst = this.findSelectAstAtOffset(ast, cteLocations, cursorOffset);
    const activeBlockRange = this.getActiveBlockRangeAtOffset(
      sanitizedSql,
      cteLocations,
      cursorOffset
    );
    const activeRelations = this.resolveScopedRelations(activeSelectAst, cteMap, relations);

    // 4. Case A1: Clicking on a table/CTE qualifier before a dot (e.g. `cus` in `SELECT cus.customer_id`)
    if (token.isQualifierBeforeDot) {
      if (tableTargetMode === 'from_alias') {
        const fromJoinAliases = locateFromJoinAliases(
          sanitizedSql,
          currentFilePath,
          activeBlockRange.start,
          activeBlockRange.end,
          relations
        );
        const localAliasLoc = fromJoinAliases.get(lowerWord);
        if (localAliasLoc) {
          return localAliasLoc;
        }
      }
      return this.resolveRelationDefinition(lowerWord, activeRelations, cteLocations);
    }

    // 5. Case A2: Clicking on a table/CTE name or alias inside a FROM or JOIN clause
    if (token.isAfterFromOrJoin) {
      return this.resolveRelationDefinition(lowerWord, activeRelations, cteLocations);
    }

    // 6. Case B: Clicking on a qualified column (`cus.customer_id` -> `customer_id`)
    if (token.qualifier) {
      const targetRel = activeRelations.get(token.qualifier.toLowerCase());
      const col = targetRel?.columns.find((c) => c.name.toLowerCase() === lowerWord);
      if (col?.definitionLocation) {
        return col.definitionLocation;
      }
      return null;
    }

    // 7. Case C: Clicking on an unqualified column or column alias inside SELECT / WHERE / ON / GROUP BY
    for (const rel of activeRelations.values()) {
      const foundCol = rel.columns.find((c) => c.name.toLowerCase() === lowerWord);
      if (foundCol?.definitionLocation) {
        return foundCol.definitionLocation;
      }
    }

    const aliasedSourceRef = this.findUnderlyingColumnForSelectAlias(
      activeSelectAst,
      lowerWord
    );
    if (aliasedSourceRef) {
      if (aliasedSourceRef.table) {
        const rel = activeRelations.get(aliasedSourceRef.table.toLowerCase());
        const col = rel?.columns.find(
          (c) => c.name.toLowerCase() === aliasedSourceRef.column.toLowerCase()
        );
        if (col?.definitionLocation) return col.definitionLocation;
      } else {
        for (const rel of activeRelations.values()) {
          const col = rel.columns.find(
            (c) => c.name.toLowerCase() === aliasedSourceRef.column.toLowerCase()
          );
          if (col?.definitionLocation) return col.definitionLocation;
        }
      }
    }

    // 8. Fallback: check if the identifier is a relation alias or CTE name
    return this.resolveRelationDefinition(lowerWord, activeRelations, cteLocations);
  }

  private getActiveBlockRangeAtOffset(
    sanitizedSql: string,
    cteLocations: Map<string, CteLocationBlock>,
    cursorOffset: number
  ): { start: number; end: number } {
    for (const loc of cteLocations.values()) {
      if (cursorOffset >= loc.bodyStartOffset && cursorOffset <= loc.bodyEndOffset) {
        return { start: loc.bodyStartOffset, end: loc.bodyEndOffset };
      }
    }
    return {
      start: this.getMainQueryStartOffset(cteLocations),
      end: sanitizedSql.length,
    };
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

    const cteMap = this.extractLocalCtes(ast, relations, healed.healedSql);

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

  private resolveRelationDefinition(
    lowerIdentifier: string,
    activeRelations: Map<string, ScopedRelation>,
    cteLocations: Map<string, CteLocationBlock>
  ): SourceLocation | null {
    const scopedRel = activeRelations.get(lowerIdentifier);
    if (scopedRel) {
      if (scopedRel.sourceKind === 'cte') {
        return cteLocations.get(scopedRel.targetName.toLowerCase())?.nameLocation ?? null;
      }
      return this.getModelFileStartLocation(scopedRel.targetName);
    }

    // Also check if the user clicked on the targetName directly when an alias is present
    for (const rel of activeRelations.values()) {
      if (rel.targetName.toLowerCase() === lowerIdentifier) {
        if (rel.sourceKind === 'cte') {
          return cteLocations.get(lowerIdentifier)?.nameLocation ?? null;
        }
        return this.getModelFileStartLocation(rel.targetName);
      }
    }

    const cteLoc = cteLocations.get(lowerIdentifier);
    if (cteLoc) {
      return cteLoc.nameLocation;
    }

    return this.getModelFileStartLocation(lowerIdentifier);
  }

  private getModelFileStartLocation(modelName: string): SourceLocation | null {
    const model = this.registry.getModel(modelName);
    if (!model || !model.filePath) return null;
    return {
      filePath: model.filePath,
      line: 0,
      startColumn: 0,
      endColumn: 0,
    };
  }

  private getMainQueryStartOffset(cteLocations: Map<string, CteLocationBlock>): number {
    let maxEnd = 0;
    for (const block of cteLocations.values()) {
      if (block.bodyEndOffset > maxEnd) {
        maxEnd = block.bodyEndOffset;
      }
    }
    return maxEnd;
  }

  private findSelectAstAtOffset(
    rootAst: any,
    cteLocations: Map<string, CteLocationBlock>,
    cursorOffset: number
  ): any {
    if (Array.isArray(rootAst?.with)) {
      for (const cteDef of rootAst.with) {
        const cteName = this.unwrapIdentifier(cteDef?.name)?.toLowerCase();
        if (!cteName) continue;
        const loc = cteLocations.get(cteName);
        if (loc && cursorOffset >= loc.bodyStartOffset && cursorOffset <= loc.bodyEndOffset) {
          return cteDef?.stmt?.ast ?? cteDef?.stmt ?? rootAst;
        }
      }
    }
    return rootAst;
  }

  private findUnderlyingColumnForSelectAlias(
    selectAst: any,
    lowerAliasName: string
  ): { table?: string; column: string } | undefined {
    const columns = selectAst?.columns;
    if (!Array.isArray(columns)) return undefined;

    for (const colItem of columns) {
      const explicitAlias = this.unwrapIdentifier(colItem?.as)?.toLowerCase();
      if (explicitAlias === lowerAliasName) {
        return this.extractFirstColumnRefFromExpr(colItem?.expr);
      }
    }
    return undefined;
  }

  private extractFirstColumnRefFromExpr(
    expr: any
  ): { table?: string; column: string } | undefined {
    if (!expr || typeof expr !== 'object') return undefined;

    const directCol = this.unwrapIdentifier(expr.column);
    if (directCol && directCol !== '*' && directCol !== CURSOR_SYNTHETIC_TOKEN) {
      return {
        table: this.unwrapIdentifier(expr.table),
        column: directCol,
      };
    }

    for (const value of Object.values(expr)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = this.extractFirstColumnRefFromExpr(item);
          if (found) return found;
        }
      } else if (value && typeof value === 'object') {
        const found = this.extractFirstColumnRefFromExpr(value);
        if (found) return found;
      }
    }

    return undefined;
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

    if (expr.type === 'cast') {
      const target = Array.isArray(expr.target) ? expr.target[0] : expr.target;
      if (typeof target?.dataType === 'string') {
        return target.dataType.toUpperCase();
      }
    }

    if (expr.type === 'aggr_func' && typeof expr.name === 'string') {
      const funcName = expr.name.toUpperCase();
      if (funcName === 'COUNT') return 'BIGINT';
      if (funcName === 'SUM' || funcName === 'AVG') return 'NUMERIC';
    }

    if (expr.type === 'binary_expr' && ['/', '*', '+', '-'].includes(expr.operator)) {
      return 'NUMERIC';
    }

    return undefined;
  }

  private extractLocalCtes(
    rootAst: any,
    relations: Map<string, DbtRelationToken>,
    sanitizedSql = '',
    filePath = '',
    precomputedCteLocations?: Map<string, CteLocationBlock>
  ): Map<string, ColumnMetadata[]> {
    const cteColumns = new Map<string, ColumnMetadata[]>();
    const withClause: any[] | undefined = rootAst?.with;

    if (!Array.isArray(withClause)) {
      return cteColumns;
    }

    const cteLocations =
      precomputedCteLocations ??
      (sanitizedSql ? locateCteDefinitions(sanitizedSql, filePath) : new Map());

    for (const cteDef of withClause) {
      const cteName = this.unwrapIdentifier(cteDef?.name);
      const cteStmt = cteDef?.stmt?.ast ?? cteDef?.stmt;
      if (!cteName || !cteStmt) continue;

      const cteBlock = cteLocations.get(cteName.toLowerCase());
      const projectedLocations =
        cteBlock && sanitizedSql
          ? locateSelectProjectionColumns(
              sanitizedSql,
              filePath,
              cteBlock.bodyStartOffset,
              cteBlock.bodyEndOffset
            )
          : undefined;

      const scopedParents = this.resolveScopedRelations(cteStmt, cteColumns, relations);
      const projected = this.extractProjectedColumns(
        cteStmt,
        scopedParents,
        cteName,
        'cte',
        'cte_local',
        projectedLocations
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
    defaultOrigin: 'cte_local' | 'sql_inferred' = 'cte_local',
    explicitLocations?: Map<string, SourceLocation>
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
      // Preserve upstream `definitionLocation` so Ctrl+Click jumps to where the column was explicitly defined!
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
      const explicitLoc = explicitLocations?.get(effectiveName.toLowerCase());

      result.push({
        name: effectiveName,
        dataType: inferredExprType ?? upstreamMeta?.dataType,
        description: upstreamMeta?.description,
        origin: upstreamMeta?.origin ?? defaultOrigin,
        sourceModelName: currentScopeName,
        sourceKind: currentScopeKind,
        constraints: upstreamMeta?.constraints,
        dataTests: upstreamMeta?.dataTests,
        definitionLocation: explicitLoc ?? upstreamMeta?.definitionLocation,
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