// src/core/styling/dataTypePalette.ts

export interface ThemeColorPair {
  dark: string;
  light: string;
}

export type DataTypeIconKind =
  | 'integer'
  | 'float'
  | 'text'
  | 'date'
  | 'timestamp'
  | 'boolean'
  | 'complex';

export const DATA_TYPE_PALETTE: ThemeColorPair[] = [
  // 0: Integer (Red / Coral)
  { dark: '#FF5555', light: '#f11501' },
  // 1: Float & Precision (Blue)
  { dark: '#86c7f9', light: '#4199dc' },
  // 2: Textual (Green)
  { dark: '#50FA7B', light: '#3dc774' },
  // 3: Date & Time (Violet)
  { dark: '#c8a7f6', light: '#a05dff' },
  // 4: Logical / Boolean (Gold / Orange)
  { dark: '#ecbf92', light: '#f5a207' },
  // 5: Complex & Spatial (Pink / Magenta)
  { dark: '#f6bcdd', light: '#f66ab9' },
];

export function classifyDataTypeIconKind(rawType: string): DataTypeIconKind {
  const normalized = rawType.trim().toUpperCase().replace(/\(.*\)$/, '');

  if (
    /^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|HUGEINT|INT2|INT4|INT8|INT16|INT32|INT64|INT128|SERIAL|BIGSERIAL|BYTEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)$/.test(
      normalized
    )
  ) {
    return 'integer';
  }

  if (
    /^(FLOAT|FLOAT4|FLOAT8|DOUBLE|DOUBLE PRECISION|REAL|NUMERIC|DECIMAL|DEC|NUMBER|BIGNUMERIC|MONEY)$/.test(
      normalized
    )
  ) {
    return 'float';
  }

  if (
    /^(VARCHAR|CHAR|CHARACTER|CHARACTER VARYING|TEXT|STRING|NVARCHAR|NCHAR|BPCHAR|UUID|CITEXT|CLOB|BINARY|VARBINARY|BLOB|BYTEA)$/.test(
      normalized
    )
  ) {
    return 'text';
  }

  if (/^(DATE|YEAR)$/.test(normalized)) {
    return 'date';
  }

  if (
    /^(DATETIME|TIME|TIMETZ|TIMESTAMP|TIMESTAMPTZ|TIMESTAMP_NTZ|TIMESTAMP_LTZ|TIMESTAMP_TZ|INTERVAL)$/.test(
      normalized
    )
  ) {
    return 'timestamp';
  }

  if (/^(BOOL|BOOLEAN|BIT|LOGICAL)$/.test(normalized)) {
    return 'boolean';
  }

  return 'complex';
}

export function classifyDataTypeIndex(rawType: string): number {
  const kind = classifyDataTypeIconKind(rawType);
  switch (kind) {
    case 'integer':
      return 0;
    case 'float':
      return 1;
    case 'text':
      return 2;
    case 'date':
    case 'timestamp':
      return 3;
    case 'boolean':
      return 4;
    case 'complex':
      return 5;
  }
}

export function getDataTypeColor(
  dataType: string | undefined,
  isLightTheme = false
): string | undefined {
  if (!dataType) return undefined;
  const idx = classifyDataTypeIndex(dataType);
  const pair = DATA_TYPE_PALETTE[idx] ?? DATA_TYPE_PALETTE[5]!;
  return isLightTheme ? pair.light : pair.dark;
}

/**
 * Returns the compact visual glyph displayed in the left completion list for a SQL data type.
 */
export function getDataTypeShortGlyph(dataType: string | undefined): string {
  if (!dataType) return '';
  const kind = classifyDataTypeIconKind(dataType);
  switch (kind) {
    case 'integer':
      return '123';
    case 'float':
      return '1.2';
    case 'text':
      return 'abc';
    case 'date':
      return '📅';
    case 'timestamp':
      return '🕒';
    case 'boolean':
      return 'T/F';
    case 'complex':
      return '{ }';
  }
}