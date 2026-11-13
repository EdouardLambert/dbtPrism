// src/core/styling/svgBadges.ts

import {
  classifyDataTypeIconKind,
  DataTypeIconKind,
  getDataTypeColor,
} from './dataTypePalette.js';
import { RelationMaterialization } from '../types.js';

const svgCache = new Map<string, string>();

/**
 * Renders the first line of the column documentation panel as a single unified SVG:
 * [Subtype Icon | TYPE] • source_name.<b>column_name</b>
 */
export function renderColumnHeaderMarkdown(
  dataType: string | undefined,
  sourceName: string | undefined,
  columnName: string | undefined,
  isLightTheme: boolean
): string {
  const cacheKey = `colhdr:${dataType ?? 'unk'}:${sourceName ?? ''}:${columnName ?? ''}:${isLightTheme ? 'L' : 'D'}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const height = 22;
  const hasKnownType = Boolean(dataType && dataType.trim().length > 0);
  const typeLabel = hasKnownType ? dataType!.toUpperCase() : 'UNKNOWN';
  const typeColor = hasKnownType
    ? (getDataTypeColor(dataType, isLightTheme) ?? '#86c7f9')
    : isLightTheme
      ? '#6B7280'
      : '#9CA3AF';

  const iconKind: DataTypeIconKind | 'unknown' = hasKnownType
    ? classifyDataTypeIconKind(dataType!)
    : 'unknown';

  const iconWidth = 26;
  const typeTextWidth = Math.ceil(typeLabel.length * 6.5) + 12;
  const typeBadgeWidth = iconWidth + typeTextWidth;

  let currentX = typeBadgeWidth;
  let targetLabelSvg = '';

  if (columnName) {
    const dotX = currentX + 10;
    const dotColor = isLightTheme ? '#9CA3AF' : '#6B7280';
    const sourcePrefixColor = isLightTheme ? '#4B5563' : '#9CA3AF';
    const colTextColor = isLightTheme ? '#111827' : '#F3F4F6';

    const textStartX = dotX + 9;
    const fullLabelLength =
      (sourceName ? sourceName.length + 1 : 0) + columnName.length;
    const textWidth = Math.ceil(fullLabelLength * 7.4);

    const sourcePrefixTspan = sourceName
      ? `<tspan fill="${sourcePrefixColor}" font-weight="400">${escapeXml(sourceName)}.</tspan>`
      : '';

    targetLabelSvg = `
      <circle cx="${dotX}" cy="11" r="1.8" fill="${dotColor}"/>
      <text x="${textStartX}" y="15" font-family="Consolas, 'JetBrains Mono', monospace" font-size="12">${sourcePrefixTspan}<tspan fill="${colTextColor}" font-weight="700">${escapeXml(columnName)}</tspan></text>
    `;

    currentX = textStartX + textWidth + 6;
  }

  const totalWidth = currentX;
  const iconSvg = renderVectorTypeGlyph(iconKind, typeColor);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
    <rect x="0.5" y="1" width="${typeBadgeWidth - 1}" height="20" rx="4" fill="${typeColor}" fill-opacity="0.14" stroke="${typeColor}" stroke-opacity="0.45"/>
    <line x1="${iconWidth}" y1="4" x2="${iconWidth}" y2="18" stroke="${typeColor}" stroke-opacity="0.3"/>
    ${iconSvg}
    <text x="${iconWidth + 6}" y="14.8" fill="${typeColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="10.5" font-weight="700">${escapeXml(typeLabel)}</text>
    ${targetLabelSvg}
  </svg>`;

  const md = toMarkdownDataUri(svg);
  svgCache.set(cacheKey, md);
  return md;
}

/**
 * Renders the first line of the table / CTE documentation panel in standard neutral grey
 * while keeping the custom vector materialization icon:
 * [Materialization Icon | VIEW / TABLE / CTE / INCREMENTAL] • table_name
 */
export function renderRelationHeaderMarkdown(
  materialized: RelationMaterialization | string | undefined,
  relationName: string,
  isLightTheme: boolean
): string {
  const matKind = (materialized ?? 'model').toLowerCase();
  const cacheKey = `relhdr:${matKind}:${relationName}:${isLightTheme ? 'L' : 'D'}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const height = 22;
  const matLabel = matKind.toUpperCase();
  // Standard neutral grey for all relation materialization badges
  const badgeColor = isLightTheme ? '#6B7280' : '#9CA3AF';

  const iconWidth = 26;
  const matTextWidth = Math.ceil(matLabel.length * 6.5) + 12;
  const matBadgeWidth = iconWidth + matTextWidth;

  const dotX = matBadgeWidth + 10;
  const dotColor = isLightTheme ? '#9CA3AF' : '#6B7280';
  const relTextColor = isLightTheme ? '#111827' : '#F3F4F6';
  const textStartX = dotX + 9;
  const textWidth = Math.ceil(relationName.length * 7.4);
  const totalWidth = textStartX + textWidth + 6;

  const iconSvg = renderVectorMaterializationGlyph(matKind, badgeColor);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
    <rect x="0.5" y="1" width="${matBadgeWidth - 1}" height="20" rx="4" fill="${badgeColor}" fill-opacity="0.14" stroke="${badgeColor}" stroke-opacity="0.45"/>
    <line x1="${iconWidth}" y1="4" x2="${iconWidth}" y2="18" stroke="${badgeColor}" stroke-opacity="0.3"/>
    ${iconSvg}
    <text x="${iconWidth + 6}" y="14.8" fill="${badgeColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="10.5" font-weight="700">${escapeXml(matLabel)}</text>
    <circle cx="${dotX}" cy="11" r="1.8" fill="${dotColor}"/>
    <text x="${textStartX}" y="15" fill="${relTextColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="12" font-weight="700">${escapeXml(relationName)}</text>
  </svg>`;

  const md = toMarkdownDataUri(svg);
  svgCache.set(cacheKey, md);
  return md;
}

/**
 * Wrapper for standalone type badge rendering.
 */
export function renderDataTypeBadgeMarkdown(
  dataType: string,
  isLightTheme: boolean
): string {
  return renderColumnHeaderMarkdown(dataType, undefined, undefined, isLightTheme);
}

/**
 * Legacy wrapper kept for compatibility.
 */
export function renderMaterializationBadgeMarkdown(
  materialized: string,
  isLightTheme: boolean
): string {
  return renderRelationHeaderMarkdown(materialized, materialized, isLightTheme);
}

/**
 * Builds a compact pill badge for a constraint (#EF4444) or a data_test (#F97316).
 */
export function renderRulePillMarkdown(
  label: string,
  kind: 'constraint' | 'data_test'
): string {
  const cacheKey = `pill:${kind}:${label}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const color = kind === 'constraint' ? '#EF4444' : '#F97316';
  const iconOffset = 17;
  const textWidth = Math.ceil(label.length * 5.9) + 8;
  const totalWidth = iconOffset + textWidth;
  const height = 20;

  const iconPath =
    kind === 'constraint'
      ? `<path d="M8.5 4.5L4.8 6.1v3.2c0 2.4 1.6 4.6 3.7 5.3 2.1-.7 3.7-2.9 3.7-5.3V6.1L8.5 4.5z" fill="none" stroke="${color}" stroke-width="1.25"/>`
      : `<path d="M5.2 10.2l2.1 2.1 4.5-4.5" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
    <rect x="0.5" y="0.5" width="${totalWidth - 1}" height="${height - 1}" rx="4" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.45"/>
    ${iconPath}
    <text x="${iconOffset}" y="13.6" fill="${color}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="10" font-weight="600">${escapeXml(label)}</text>
  </svg>`;

  const md = toMarkdownDataUri(svg);
  svgCache.set(cacheKey, md);
  return md;
}

function renderVectorMaterializationGlyph(matKind: string, color: string): string {
  switch (matKind) {
    case 'table':
      // Vector 3x2 Data Table Grid icon
      return `<g fill="none" stroke="${color}" stroke-width="1.2">
        <rect x="7" y="6" width="12" height="10" rx="1.5"/>
        <line x1="7" y1="9.5" x2="19" y2="9.5"/>
        <line x1="13" y1="9.5" x2="13" y2="16"/>
      </g>`;
    case 'view':
      // Vector Eye icon
      return `<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.5 11s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z"/>
        <circle cx="13" cy="11" r="1.8" fill="${color}"/>
      </g>`;
    case 'incremental':
      // Vector Lightning Bolt icon (fast delta append)
      return `<path d="M14 5.2L8.8 11.5h3.7l-1 5.3 5.7-6.5h-3.7L14 5.2z" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>`;
    case 'cte':
      // Vector Connected Workflow Nodes icon
      return `<g fill="none" stroke="${color}" stroke-width="1.2">
        <circle cx="9.2" cy="8" r="1.8"/>
        <circle cx="16.8" cy="8" r="1.8"/>
        <circle cx="13" cy="14.5" r="1.8"/>
        <line x1="10.6" y1="9.2" x2="12" y2="13"/>
        <line x1="15.4" y1="9.2" x2="14" y2="13"/>
      </g>`;
    case 'snapshot':
      // Vector History / Camera-Clock icon
      return `<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round">
        <circle cx="13" cy="11" r="5"/>
        <polyline points="13,8.5 13,11 15,12"/>
      </g>`;
    default:
      // Vector Database Cylinder icon
      return `<g fill="none" stroke="${color}" stroke-width="1.2">
        <ellipse cx="13" cy="7.2" rx="5" ry="1.8"/>
        <path d="M8 7.2v7.6c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V7.2"/>
        <path d="M8 11c0 1 2.2 1.8 5 1.8s5-.8 5-1.8"/>
      </g>`;
  }
}

function renderVectorTypeGlyph(
  kind: DataTypeIconKind | 'unknown',
  color: string
): string {
  switch (kind) {
    case 'smallint':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">12</text>`;
    case 'integer':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">123</text>`;
    case 'bigint':
      return `<g>
        <text x="10"   y="10.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">1</text>
        <text x="16.2" y="10.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">2</text>
        <text x="10"   y="17.8" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">3</text>
        <text x="16.2" y="17.8" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">4</text>
      </g>`;
    case 'decimal':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">.00</text>`;
    case 'float':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">1.2</text>`;
    case 'money':
      return `<text x="13" y="14.8" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="10.5" font-weight="800">$</text>`;
    case 'text':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">abc</text>`;
    case 'char':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">&quot;a&quot;</text>`;
    case 'uuid':
      return `<g fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9.5" cy="11" r="2.8"/>
        <path d="M12.3 11H19M16.5 11v2.2M18.5 11v2.2"/>
      </g>`;
    case 'binary':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">01</text>`;
    case 'date':
      return `<g fill="none" stroke="${color}" stroke-width="1.2">
        <rect x="7.5" y="6" width="11" height="10" rx="1.5"/>
        <line x1="7.5" y1="9" x2="18.5" y2="9"/>
        <line x1="10" y1="4.5" x2="10" y2="7"/>
        <line x1="16" y1="4.5" x2="16" y2="7"/>
      </g>`;
    case 'timestamp':
      return `<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round">
        <circle cx="13" cy="11" r="5.2"/>
        <polyline points="13,8.2 13,11.2 15.2,12.5"/>
      </g>`;
    case 'timestamptz':
      return `<g fill="none" stroke="${color}" stroke-width="1.15">
        <circle cx="13" cy="11" r="5.3"/>
        <ellipse cx="13" cy="11" rx="2.4" ry="5.3"/>
        <line x1="7.7" y1="11" x2="18.3" y2="11"/>
      </g>`;
    case 'time':
      return `<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round">
        <line x1="11.2" y1="4.8" x2="14.8" y2="4.8"/>
        <line x1="13" y1="4.8" x2="13" y2="6.3"/>
        <circle cx="13" cy="11.5" r="4.8"/>
        <polyline points="13,9.2 13,11.5 14.8,11.5"/>
      </g>`;
    case 'interval':
      return `<g fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <line x1="7.5" y1="11" x2="18.5" y2="11"/>
        <polyline points="10,8.5 7.5,11 10,13.5"/>
        <polyline points="16,8.5 18.5,11 16,13.5"/>
      </g>`;
    case 'boolean':
      return `<g fill="none" stroke="${color}" stroke-width="1.25">
        <rect x="6.5" y="7.5" width="13" height="7" rx="3.5"/>
        <circle cx="15.8" cy="11" r="2" fill="${color}"/>
      </g>`;
    case 'bit':
      return `<text x="13" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">0/1</text>`;
    case 'json':
      return `<text x="13" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">{ }</text>`;
    case 'array':
      return `<text x="13" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">[ ]</text>`;
    case 'spatial':
      return `<g fill="none" stroke="${color}" stroke-width="1.25" stroke-linejoin="round">
        <path d="M13 16.5s4-3.2 4-6.2a4 4 0 1 0-8 0c0 3 4 6.2 4 6.2z"/>
        <circle cx="13" cy="10.2" r="1.3" fill="${color}"/>
      </g>`;
    case 'unknown':
      return `<text x="13" y="14.5" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="10" font-weight="800">?</text>`;
  }
}

function toMarkdownDataUri(svg: string): string {
  const compact = svg.replace(/\s+/g, ' ').trim();
  const base64 = Buffer.from(compact, 'utf-8').toString('base64');
  return `![](data:image/svg+xml;base64,${base64})`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}