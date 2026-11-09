// tests/core/styling/dataTypePalette.test.ts

import { describe, expect, it } from 'vitest';
import {
  DATA_TYPE_PALETTE,
  getDataTypeColor,
  getDataTypeShortGlyph,
} from '../../../src/core/styling/dataTypePalette.js';
import {
  renderDataTypeBadgeMarkdown,
  renderRulePillMarkdown,
} from '../../../src/core/styling/svgBadges.js';

describe('dataTypePalette & svgBadges - SQL Data Type Styling', () => {
  it('maps SQL types to their exact DATA_TYPE_PALETTE colors', () => {
    expect(getDataTypeColor('INTEGER', false)).toBe(DATA_TYPE_PALETTE[0]!.dark);
    expect(getDataTypeColor('NUMERIC(10, 2)', false)).toBe(DATA_TYPE_PALETTE[1]!.dark);
    expect(getDataTypeColor('VARCHAR(255)', false)).toBe(DATA_TYPE_PALETTE[2]!.dark);
    expect(getDataTypeColor('DATE', false)).toBe(DATA_TYPE_PALETTE[3]!.dark);
    expect(getDataTypeColor('TIMESTAMP', false)).toBe(DATA_TYPE_PALETTE[3]!.dark);
    expect(getDataTypeColor('BOOLEAN', false)).toBe(DATA_TYPE_PALETTE[4]!.dark);
    expect(getDataTypeColor('JSONB', false)).toBe(DATA_TYPE_PALETTE[5]!.dark);
  });

  it('returns distinct short visual glyphs for integer, float, text, date, and timestamp', () => {
    expect(getDataTypeShortGlyph('INTEGER')).toBe('123');
    expect(getDataTypeShortGlyph('DOUBLE')).toBe('1.2');
    expect(getDataTypeShortGlyph('VARCHAR')).toBe('abc');
    expect(getDataTypeShortGlyph('DATE')).toBe('📅');
    expect(getDataTypeShortGlyph('TIMESTAMP')).toBe('🕒');
  });

  it('generates valid base64 SVG Markdown badges for types, constraints, and data_tests', () => {
    const typeBadge = renderDataTypeBadgeMarkdown('INTEGER', false);
    const constraintPill = renderRulePillMarkdown('primary_key', 'constraint');
    const testPill = renderRulePillMarkdown('unique', 'data_test');

    expect(typeBadge).toMatch(/^!\[\]\(data:image\/svg\+xml;base64,/);
    expect(constraintPill).toMatch(/^!\[\]\(data:image\/svg\+xml;base64,/);
    expect(testPill).toMatch(/^!\[\]\(data:image\/svg\+xml;base64,/);
  });
});