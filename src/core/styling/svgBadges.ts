// src/core/styling/svgBadges.ts

import {
  classifyDataTypeIconKind,
  DataTypeIconKind,
  getDataTypeColor,
} from './dataTypePalette.js';

const svgCache = new Map<string, string>();

/**
 * Renders the first line of the column documentation panel as a single unified SVG:
 * [Subtype Icon | TYPE] • column_name
 */
export function renderColumnHeaderMarkdown(
  dataType: string | undefined,
  columnName: string | undefined,
  isLightTheme: boolean
): string {
  const cacheKey = `hdr:${dataType ?? 'unk'}:${columnName ?? ''}:${isLightTheme ? 'L' : 'D'}`;
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
  let columnNameSvg = '';

  if (columnName) {
    const dotX = currentX + 10;
    const dotColor = isLightTheme ? '#9CA3AF' : '#6B7280';
    const colTextColor = isLightTheme ? '#111827' : '#F3F4F6';

    const colTextX = dotX + 9;
    const colTextWidth = Math.ceil(columnName.length * 7.4);

    columnNameSvg = `
      <circle cx="${dotX}" cy="11" r="1.8" fill="${dotColor}"/>
      <text x="${colTextX}" y="15" fill="${colTextColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="12" font-weight="700">${escapeXml(columnName)}</text>
    `;

    currentX = colTextX + colTextWidth + 4;
  }

  const totalWidth = currentX;
  const iconSvg = renderVectorTypeGlyph(iconKind, typeColor);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
    <rect x="0.5" y="1" width="${typeBadgeWidth - 1}" height="20" rx="4" fill="${typeColor}" fill-opacity="0.14" stroke="${typeColor}" stroke-opacity="0.45"/>
    <line x1="${iconWidth}" y1="4" x2="${iconWidth}" y2="18" stroke="${typeColor}" stroke-opacity="0.3"/>
    ${iconSvg}
    <text x="${iconWidth + 6}" y="14.8" fill="${typeColor}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="10.5" font-weight="700">${escapeXml(typeLabel)}</text>
    ${columnNameSvg}
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
  return renderColumnHeaderMarkdown(dataType, undefined, isLightTheme);
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

/**
 * Draws the custom vector glyph centered inside the 26x22 left icon compartment (center x=13, y=11).
 */
function renderVectorTypeGlyph(
  kind: DataTypeIconKind | 'unknown',
  color: string
): string {
  switch (kind) {
    // 0. Integers: 12 | 123 | 1234
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

    // 1. Float & Precision: .00 | 1.2 | $
    case 'decimal':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">.00</text>`;
    case 'float':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">1.2</text>`;
    case 'money':
      return `<text x="13" y="14.8" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="10.5" font-weight="800">$</text>`;

    // 2. Textual & Binary: abc | "a" | Key icon | 01
    case 'text':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">abc</text>`;
    case 'char':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">&quot;a&quot;</text>`;
    case 'uuid':
      // Vector Key icon
      return `<g fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9.5" cy="11" r="2.8"/>
        <path d="M12.3 11H19M16.5 11v2.2M18.5 11v2.2"/>
      </g>`;
    case 'binary':
      return `<text x="13" y="14.2" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">01</text>`;

    // 3. Date & Time: Calendar | Clock | Globe | Stopwatch | Bidirectional Arrow
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
      // Vector Globe icon
      return `<g fill="none" stroke="${color}" stroke-width="1.15">
        <circle cx="13" cy="11" r="5.3"/>
        <ellipse cx="13" cy="11" rx="2.4" ry="5.3"/>
        <line x1="7.7" y1="11" x2="18.3" y2="11"/>
      </g>`;
    case 'time':
      // Vector Stopwatch icon
      return `<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round">
        <line x1="11.2" y1="4.8" x2="14.8" y2="4.8"/>
        <line x1="13" y1="4.8" x2="13" y2="6.3"/>
        <circle cx="13" cy="11.5" r="4.8"/>
        <polyline points="13,9.2 13,11.5 14.8,11.5"/>
      </g>`;
    case 'interval':
      // Vector Bidirectional Arrow <->
      return `<g fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <line x1="7.5" y1="11" x2="18.5" y2="11"/>
        <polyline points="10,8.5 7.5,11 10,13.5"/>
        <polyline points="16,8.5 18.5,11 16,13.5"/>
      </g>`;

    // 4. Logical / Boolean: Toggle Switch | 0/1
    case 'boolean':
      // Vector Toggle Switch (ON position)
      return `<g fill="none" stroke="${color}" stroke-width="1.25">
        <rect x="6.5" y="7.5" width="13" height="7" rx="3.5"/>
        <circle cx="15.8" cy="11" r="2" fill="${color}"/>
      </g>`;
    case 'bit':
      return `<text x="13" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">0/1</text>`;

    // 5. Complex & Spatial: { } | [ ] | Map Pin
    case 'json':
      return `<text x="13" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">{ }</text>`;
    case 'array':
      return `<text x="13" y="14" text-anchor="middle" fill="${color}" font-family="Consolas, monospace" font-size="9" font-weight="800">[ ]</text>`;
    case 'spatial':
      // Vector Map Pin icon
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