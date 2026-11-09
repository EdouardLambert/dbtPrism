// src/extension/extension.ts

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspaceIndexer } from '../core/indexer/workspaceIndexer.js';
import { SqlScopeAnalyzer } from '../core/analyzer/sqlScopeAnalyzer.js';
import { CompletionCandidate } from '../core/types.js';
import {
  renderColumnHeaderMarkdown,
  renderMaterializationBadgeMarkdown,
  renderRulePillMarkdown,
} from '../core/styling/svgBadges.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const indexer = new WorkspaceIndexer();
  const analyzer = new SqlScopeAnalyzer(indexer);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(sync~spin) dbt Prism: Indexing...';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const indexAllWorkspaces = async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const rootPath = folder.uri.fsPath;
      await indexer.indexWorkspaceFolder(rootPath);

      const playgroundPath = path.join(rootPath, 'playground', 'jaffle_prism');
      if (fs.existsSync(playgroundPath)) {
        await indexer.indexWorkspaceFolder(playgroundPath);
      }
    }
    const count = indexer.getAllModels().length;
    statusBar.text = `$(database) dbt Prism: ${count} models`;
    statusBar.tooltip = 'dbt Prism semantic SQL & schema.yml index is active';
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
        statusBar.text = `$(database) dbt Prism: ${indexer.getAllModels().length} models`;
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

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'sql' }, { language: 'jinja-sql' }, { pattern: '**/*.sql' }],
      provider,
      '.',
      "'",
      '"'
    )
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

  // 1. Unified SVG Header: [Icon | TYPE] • source_table [materialization]
  md.appendMarkdown(
    renderColumnHeaderMarkdown(
      candidate.dataType,
      candidate.sourceName,
      candidate.sourceKind,
      isLightTheme
    )
  );

  // 2. Description line in italic and #6B7280
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

function buildRelationDocumentationMarkdown(
  candidate: CompletionCandidate,
  isLightTheme: boolean
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  md.isTrusted = true;

  const matBadge = renderMaterializationBadgeMarkdown(
    candidate.sourceKind ?? 'model',
    isLightTheme
  );
  const target = candidate.sourceName ?? candidate.label;
  md.appendMarkdown(`**\`${escapeHtml(target)}\`** &nbsp;${matBadge}`);
  return md;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function deactivate(): void {}