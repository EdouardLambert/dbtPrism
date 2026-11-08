// tests/core/styling/dataTypePalette.test.ts

import { describe, expect, it } from 'vitest';
import {
  DATA_TYPE_PALETTE,
  getDataTypeColor,
} from '../../../src/core/styling/dataTypePalette.js';

describe('dataTypePalette - SQL Data Type Color Classification', () => {
  it('maps integer types to palette index 0 (Coral Red)', () => {
    expect(getDataTypeColor('INTEGER', false)).toBe(DATA_TYPE_PALETTE[0]!.dark);
    expect(getDataTypeColor('BIGINT', true)).toBe(DATA_TYPE_PALETTE[0]!.light);
  });

  it('maps float and precision types to palette index 1 (Blue)', () => {
    expect(getDataTypeColor('NUMERIC(10, 2)', false)).toBe(DATA_TYPE_PALETTE[1]!.dark);
    expect(getDataTypeColor('DOUBLE PRECISION', false)).toBe(DATA_TYPE_PALETTE[1]!.dark);
  });

  it('maps textual types to palette index 2 (Green)', () => {
    expect(getDataTypeColor('VARCHAR(255)', false)).toBe(DATA_TYPE_PALETTE[2]!.dark);
    expect(getDataTypeColor('TEXT', true)).toBe(DATA_TYPE_PALETTE[2]!.light);
  });

  it('maps date and timestamp types to palette index 3 (Violet)', () => {
    expect(getDataTypeColor('DATE', false)).toBe(DATA_TYPE_PALETTE[3]!.dark);
    expect(getDataTypeColor('TIMESTAMPTZ', false)).toBe(DATA_TYPE_PALETTE[3]!.dark);
  });

  it('maps boolean types to palette index 4 (Gold / Orange)', () => {
    expect(getDataTypeColor('BOOLEAN', false)).toBe(DATA_TYPE_PALETTE[4]!.dark);
  });

  it('maps complex and spatial types to palette index 5 (Pink / Magenta)', () => {
    expect(getDataTypeColor('JSONB', false)).toBe(DATA_TYPE_PALETTE[5]!.dark);
    expect(getDataTypeColor('GEOMETRY', true)).toBe(DATA_TYPE_PALETTE[5]!.light);
  });
});