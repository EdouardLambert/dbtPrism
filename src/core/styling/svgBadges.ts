// src/core/styling/svgBadges.ts

import {
  classifyDataTypeIconKind,
  DataTypeIconKind,
  getDataTypeColor,
} from './dataTypePalette.js';

const svgCache = new Map<string, string>();

/**
 * Renders the entire first line of the column documentation panel as a single unified SVG:
 * [Icon | TYPE] • source_table [materialization]
 * This guarantees pixel-perfect vertical alignment across all elements.
 */
export function renderColumnHeaderMarkdown(
  dataType: string | undefined,
  sourceName: string | undefined,
  sourceKind: string | undefined,
  isLightTheme: boolean
): string {
  const cacheKey = `hdr:${dataType ?? 'unk'}:${sourceName ?? ''}:${sourceKind ?? ''}:${isLightTheme ? 'L' : 'D'}`;
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

  const iconWidth = 22;
  const typeTextWidth = Math.ceil(typeLabel.length * 6.5) + 12;
  const typeBadgeWidth = iconWidth + typeTextWidth;

  let currentX = typeBadgeWidth;
  let sourceElementsSvg = '';

  if (sourceName) {
    const dotX = currentX + 10;
    const dotColor = isLightTheme ? '#9CA3AF' : '#6B7280';
    const sourceTextColor = isLightTheme ? '#111827' : '#F3F4F6';

    const sourceTextX = dotX + 9;
    const sourceTextWidth = Math.ceil(sourceName.length * 7.2);

    const matLabel = (sourceKind ?? 'model').toLowerCase();
    const matFg = isLightTheme ? '#4B5563' : '#9CA3AF';
    const matBg = isLightTheme ? '#E5E7EB' : '#374151';
    const matBoxX = sourceTextX + sourceTextWidth + 8;
    const matBoxWidth = Math.ceil(matLabel.length * 6.2) + 12;

    sourceElementsSvg = `
      <circle cx="${dotX}" cy="11" r="1.8" fill="${dotColor}"/>
      <text x="${sourceTextX}" y="15" fill="${sourceTextColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="11.5" font-weight="700">${escapeXml(sourceName)}</text>
      <rect x="${matBoxX}" y="2" width="${matBoxWidth}" height="18" rx="4" fill="${matBg}" fill-opacity="0.6" stroke="${matFg}" stroke-opacity="0.35"/>
      <text x="${matBoxX + matBoxWidth / 2}" y="14.5" text-anchor="middle" fill="${matFg}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10" font-weight="600">${escapeXml(matLabel)}</text>
    `;

    currentX = matBoxX + matBoxWidth + 2;
  }

  const totalWidth = currentX;
  const iconSvg = renderVectorTypeGlyph(iconKind, typeColor);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
    <rect x="0.5" y="1" width="${typeBadgeWidth - 1}" height="20" rx="4" fill="${typeColor}" fill-opacity="0.14" stroke="${typeColor}" stroke-opacity="0.45"/>
    <line x1="${iconWidth}" y1="4" x2="${iconWidth}" y2="18" stroke="${typeColor}" stroke-opacity="0.3"/>
    ${iconSvg}
    <text x="${iconWidth + 6}" y="14.8" fill="${typeColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="10.5" font-weight="700">${escapeXml(typeLabel)}</text>
    ${sourceElementsSvg}
  </svg>`;

  const md = toMarkdownDataUri(svg);
  svgCache.set(cacheKey, md);
  return md;
}

/**
 * Legacy wrapper kept for unit tests or standalone type badge rendering.
 */
export function renderDataTypeBadgeMarkdown(
  dataType: string,
  isLightTheme: boolean
): string {
  return renderColumnHeaderMarkdown(dataType, undefined, undefined, isLightTheme);
}

/**
 * Builds a subtle neutral badge for a standalone relation completion item (view, table, cte, incremental).
 */
export function renderMaterializationBadgeMarkdown(
  materialized: string,
  isLightTheme: boolean
): string {
  const cacheKey = `mat:${materialized}:${isLightTheme ? 'L' : 'D'}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const label = materialized.toLowerCase();
  const fg = isLightTheme ? '#4B5563' : '#9CA3AF';
  const bg = isLightTheme ? '#E5E7EB' : '#374151';
  const width = Math.ceil(label.length * 6.5) + 14;
  const height = 20;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4" fill="${bg}" fill-opacity="0.55" stroke="${fg}" stroke-opacity="0.35"/>
    <text x="${width / 2}" y="14" text-anchor="middle" fill="${fg}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10.5" font-weight="600">${escapeXml(label)}</text>
  </svg>`;

  const md = toMarkdownDataUri(svg);
  svgCache.set(cacheKey, md);
  return md;
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

function renderVectorTypeGlyph(
  kind: DataTypeIconKind | 'unknown',
  color: string
): string {
  switch (kind) {
    case 'integer':
      return `<text x="11" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">123</text>`;
    case 'float':
      return `<text x="11" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">1.2</text>`;
    case 'text':
      return `<text x="11" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">abc</text>`;
    case 'date':
      return `<g fill="none" stroke="${color}" stroke-width="1.2">
        <rect x="5.5" y="6" width="11" height="10" rx="1.5"/>
        <line x1="5.5" y1="9" x2="16.5" y2="9"/>
        <line x1="8" y1="4.5" x2="8" y2="7"/>
        <line x1="14" y1="4.5" x2="14" y2="7"/>
      </g>`;
    case 'timestamp':
      return `<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round">
        <circle cx="11" cy="11" r="5.2"/>
        <polyline points="11,8.2 11,11.2 13.2,12.5"/>
      </g>`;
    case 'boolean':
      return `<text x="11" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="8.5" font-weight="800">T/F</text>`;
    case 'complex':
      return `<text x="11" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">{}</text>`;
    case 'unknown':
      return `<text x="11" y="14.5" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="10" font-weight="800">?</text>`;
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