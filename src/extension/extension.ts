// src/extension/extension.ts

import * as vscode from 'vscode';
import { WorkspaceIndexer } from '../core/indexer/workspaceIndexer.js';
import { SqlScopeAnalyzer } from '../core/analyzer/sqlScopeAnalyzer.js';
import { CompletionCandidate } from '../core/types.js';
import {
  renderColumnHeaderMarkdown,
  renderRelationHeaderMarkdown,
  renderRulePillMarkdown,
} from '../core/styling/svgBadges.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const indexer = new WorkspaceIndexer();
  const analyzer = new SqlScopeAnalyzer(indexer);

  const indexAllWorkspaces = async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      await indexer.indexWorkspaceFolder(folder.uri.fsPath);
    }
  };

  await indexAllWorkspaces();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (
        doc.fileName.endsWith('.sql') ||
        doc.fileName.endsWith('.yml') ||
        doc.fileName.endsWith('.yaml')
      ) {
        await indexer.updateFile(doc.fileName);
      }
    })
  );

  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position
    ): vscode.CompletionItem[] {
      const rawSql = document.getText();
      const cursorOffset = document.offsetAt(position);
      const isLightTheme =
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;

      const candidates = analyzer.computeCompletions(rawSql, cursorOffset);
      return candidates.map((c) => toVsCodeCompletionItem(c, isLightTheme));
    },
  };

  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position
    ): vscode.Definition | null {
      const rawSql = document.getText();
      const cursorOffset = document.offsetAt(position);
      const config = vscode.workspace.getConfiguration('dbtPrism');
      const tableTargetMode = config.get<'from_alias' | 'source_model'>(
        'goToDefinition.tableTarget',
        'from_alias'
      );

      const target = analyzer.computeDefinition(rawSql, cursorOffset, document.uri.fsPath, {
        tableTargetMode,
      });

      if (!target || !target.filePath) {
        return null;
      }

      const targetUri = vscode.Uri.file(target.filePath);
      const targetRange = new vscode.Range(
        new vscode.Position(target.line, target.startColumn),
        new vscode.Position(target.line, target.endColumn)
      );

      return new vscode.Location(targetUri, targetRange);
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position
    ): vscode.Hover | null {
      const rawSql = document.getText();
      const cursorOffset = document.offsetAt(position);
      const hoverResult = analyzer.computeHover(rawSql, cursorOffset);

      if (!hoverResult) {
        return null;
      }

      const isLightTheme =
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;

      const markdown =
        hoverResult.candidate.kind === 'column'
          ? buildColumnDocumentationMarkdown(hoverResult.candidate, isLightTheme)
          : buildRelationDocumentationMarkdown(hoverResult.candidate, isLightTheme);

      const range = new vscode.Range(
        document.positionAt(hoverResult.startOffset),
        document.positionAt(hoverResult.endOffset)
      );

      return new vscode.Hover(markdown, range);
    },
  };

  const selector: vscode.DocumentSelector = [
    { language: 'sql' },
    { language: 'jinja-sql' },
    { language: 'postgres' },
    { scheme: 'file', pattern: '**/*.sql' },
  ];

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, provider, '.', "'", '"'),
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    vscode.languages.registerHoverProvider(selector, hoverProvider)
  );
}

function toVsCodeCompletionItem(
  candidate: CompletionCandidate,
  isLightTheme: boolean
): vscode.CompletionItem {
  const kindMap: Record<CompletionCandidate['kind'], vscode.CompletionItemKind> = {
    column: vscode.CompletionItemKind.Field,
    model: vscode.CompletionItemKind.Module,
    cte: vscode.CompletionItemKind.Interface,
  };

  const item = new vscode.CompletionItem(candidate.label, kindMap[candidate.kind]);
  item.insertText = candidate.insertText;
  item.sortText = String(candidate.sortPriority).padStart(4, '0');

  if (candidate.label.includes('.')) {
    const unweightedCol = candidate.label.split('.')[1] ?? '';
    item.filterText = `${unweightedCol} ${candidate.label}`;
  } else {
    item.filterText = candidate.label;
  }

  if (candidate.kind === 'column') {
    item.documentation = buildColumnDocumentationMarkdown(candidate, isLightTheme);
  } else {
    item.documentation = buildRelationDocumentationMarkdown(candidate, isLightTheme);
  }

  return item;
}

export function buildColumnDocumentationMarkdown(
  candidate: CompletionCandidate,
  isLightTheme: boolean
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  md.isTrusted = true;

  const rawColumnName = candidate.label.includes('.')
    ? (candidate.label.split('.').pop() ?? candidate.label)
    : candidate.label;

  // 1. Unified SVG Header: [Icon | TYPE] • masource.<b>macolonne</b>
  md.appendMarkdown(
    renderColumnHeaderMarkdown(
      candidate.dataType,
      candidate.sourceName,
      rawColumnName,
      isLightTheme
    )
  );

  // 2. Column description in italic and #6B7280
  if (candidate.documentation) {
    md.appendMarkdown(
      `\n\n<span style="color:#6B7280;"><i>${escapeHtml(candidate.documentation)}</i></span>`
    );
  }

  // 3. Structured Pill Badges for Constraints (#EF4444) and Data Tests (#F97316)
  const hasConstraints = Boolean(candidate.constraints && candidate.constraints.length > 0);
  const hasDataTests = Boolean(candidate.dataTests && candidate.dataTests.length > 0);

  if (hasConstraints || hasDataTests) {
    md.appendMarkdown('\n\n---\n');
    const ruleRows: string[] = [];

    if (hasConstraints && candidate.constraints) {
      const pills = candidate.constraints
        .map((c) => renderRulePillMarkdown(c, 'constraint'))
        .join(' ');
      ruleRows.push(pills);
    }

    if (hasDataTests && candidate.dataTests) {
      const pills = candidate.dataTests
        .map((t) => renderRulePillMarkdown(t, 'data_test'))
        .join(' ');
      ruleRows.push(pills);
    }

    md.appendMarkdown(ruleRows.join('\n\n'));
  }

  return md;
}

export function buildRelationDocumentationMarkdown(
  candidate: CompletionCandidate,
  isLightTheme: boolean
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  md.isTrusted = true;

  const target = candidate.sourceName ?? candidate.label;

  // 1. Unified SVG Header: [Icon | VIEW / TABLE / CTE / INCREMENTAL] • table_name
  md.appendMarkdown(
    renderRelationHeaderMarkdown(candidate.sourceKind ?? 'model', target, isLightTheme)
  );

  // 2. Table description from schema.yml in italic and #6B7280
  if (candidate.documentation) {
    md.appendMarkdown(
      `\n\n<span style="color:#6B7280;"><i>${escapeHtml(candidate.documentation)}</i></span>`
    );
  }

  return md;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function deactivate(): void {}