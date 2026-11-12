// tests/core/styling/dataTypePalette.test.ts

import { describe, expect, it } from 'vitest';
import {
  classifyDataTypeIconKind,
  DATA_TYPE_PALETTE,
  getDataTypeColor,
  getDataTypeShortGlyph,
} from '../../../src/core/styling/dataTypePalette.js';
import {
  renderColumnHeaderMarkdown,
  renderRulePillMarkdown,
} from '../../../src/core/styling/svgBadges.js';

describe('dataTypePalette & svgBadges - Granular Subtype Icons & Styling', () => {
  it('maps SQL types to their exact DATA_TYPE_PALETTE category colors', () => {
    expect(getDataTypeColor('SMALLINT', false)).toBe(DATA_TYPE_PALETTE[0]!.dark);
    expect(getDataTypeColor('INTEGER', false)).toBe(DATA_TYPE_PALETTE[0]!.dark);
    expect(getDataTypeColor('BIGINT', false)).toBe(DATA_TYPE_PALETTE[0]!.dark);
    expect(getDataTypeColor('DECIMAL(10, 2)', false)).toBe(DATA_TYPE_PALETTE[1]!.dark);
    expect(getDataTypeColor('DOUBLE PRECISION', false)).toBe(DATA_TYPE_PALETTE[1]!.dark);
    expect(getDataTypeColor('VARCHAR(255)', false)).toBe(DATA_TYPE_PALETTE[2]!.dark);
    expect(getDataTypeColor('UUID', false)).toBe(DATA_TYPE_PALETTE[2]!.dark);
    expect(getDataTypeColor('DATE', false)).toBe(DATA_TYPE_PALETTE[3]!.dark);
    expect(getDataTypeColor('TIMESTAMPTZ', false)).toBe(DATA_TYPE_PALETTE[3]!.dark);
    expect(getDataTypeColor('BOOLEAN', false)).toBe(DATA_TYPE_PALETTE[4]!.dark);
    expect(getDataTypeColor('JSONB', false)).toBe(DATA_TYPE_PALETTE[5]!.dark);
    expect(getDataTypeColor('GEOMETRY', false)).toBe(DATA_TYPE_PALETTE[5]!.dark);
  });

  it('distinguishes integer subtypes (12 vs 123 vs 1234)', () => {
    expect(getDataTypeShortGlyph('SMALLINT')).toBe('12');
    expect(getDataTypeShortGlyph('TINYINT')).toBe('12');
    expect(getDataTypeShortGlyph('INTEGER')).toBe('123');
    expect(getDataTypeShortGlyph('BIGINT')).toBe('1234');
    expect(getDataTypeShortGlyph('HUGEINT')).toBe('1234');
  });

  it('distinguishes float, decimal, and money subtypes (.00 vs 1.2 vs $)', () => {
    expect(getDataTypeShortGlyph('DECIMAL(18,2)')).toBe('.00');
    expect(getDataTypeShortGlyph('NUMERIC')).toBe('.00');
    expect(getDataTypeShortGlyph('DOUBLE')).toBe('1.2');
    expect(getDataTypeShortGlyph('FLOAT')).toBe('1.2');
    expect(getDataTypeShortGlyph('MONEY')).toBe('$');
  });

  it('distinguishes textual, char, uuid, and binary subtypes', () => {
    expect(classifyDataTypeIconKind('VARCHAR')).toBe('text');
    expect(classifyDataTypeIconKind('CHAR(2)')).toBe('char');
    expect(classifyDataTypeIconKind('UUID')).toBe('uuid');
    expect(classifyDataTypeIconKind('BYTEA')).toBe('binary');
  });

  it('distinguishes date, timestamp, timestamptz, time, and interval subtypes', () => {
    expect(classifyDataTypeIconKind('DATE')).toBe('date');
    expect(classifyDataTypeIconKind('TIMESTAMP')).toBe('timestamp');
    expect(classifyDataTypeIconKind('TIMESTAMPTZ')).toBe('timestamptz');
    expect(classifyDataTypeIconKind('TIME')).toBe('time');
    expect(classifyDataTypeIconKind('INTERVAL')).toBe('interval');
  });

  it('distinguishes boolean, bit, json, array, and spatial subtypes', () => {
    expect(classifyDataTypeIconKind('BOOLEAN')).toBe('boolean');
    expect(classifyDataTypeIconKind('BIT')).toBe('bit');
    expect(classifyDataTypeIconKind('JSONB')).toBe('json');
    expect(classifyDataTypeIconKind('ARRAY')).toBe('array');
    expect(classifyDataTypeIconKind('VARCHAR[]')).toBe('array');
    expect(classifyDataTypeIconKind('GEOMETRY')).toBe('spatial');
  });

  it('generates valid SVG Markdown badges for all 18 subtype icons', () => {
    const sampleTypes = [
      'SMALLINT',
      'INTEGER',
      'BIGINT',
      'DECIMAL',
      'DOUBLE',
      'MONEY',
      'VARCHAR',
      'CHAR',
      'UUID',
      'BYTEA',
      'DATE',
      'TIMESTAMP',
      'TIMESTAMPTZ',
      'TIME',
      'INTERVAL',
      'BOOLEAN',
      'BIT',
      'JSONB',
      'ARRAY',
      'GEOMETRY',
    ];

    for (const sqlType of sampleTypes) {
      const badge = renderColumnHeaderMarkdown(sqlType, 'test_col', false);
      expect(badge).toMatch(/^!\[\]\(data:image\/svg\+xml;base64,/);
    }

    const constraintPill = renderRulePillMarkdown('primary_key', 'constraint');
    expect(constraintPill).toMatch(/^!\[\]\(data:image\/svg\+xml;base64,/);
  });
});