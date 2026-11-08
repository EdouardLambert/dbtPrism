// src/core/styling/dataTypePalette.ts

export interface ThemeColorPair {
  dark: string;
  light: string;
}

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

/**
 * Maps a SQL data type name to its category index (0..5) in DATA_TYPE_PALETTE.
 */
export function classifyDataTypeIndex(rawType: string): number {
  const normalized = rawType.trim().toUpperCase().replace(/\(.*\)$/, '');

  // 0: Integer types
  if (
    /^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|HUGEINT|INT2|INT4|INT8|INT16|INT32|INT64|INT128|SERIAL|BIGSERIAL|BYTEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)$/.test(
      normalized
    )
  ) {
    return 0;
  }

  // 1: Float & Precision types
  if (
    /^(FLOAT|FLOAT4|FLOAT8|DOUBLE|DOUBLE PRECISION|REAL|NUMERIC|DECIMAL|DEC|NUMBER|BIGNUMERIC|MONEY)$/.test(
      normalized
    )
  ) {
    return 1;
  }

  // 2: Textual types
  if (
    /^(VARCHAR|CHAR|CHARACTER|CHARACTER VARYING|TEXT|STRING|NVARCHAR|NCHAR|BPCHAR|UUID|CITEXT|CLOB|BINARY|VARBINARY|BLOB|BYTEA)$/.test(
      normalized
    )
  ) {
    return 2;
  }

  // 3: Date & Time types
  if (
    /^(DATE|DATETIME|TIME|TIMETZ|TIMESTAMP|TIMESTAMPTZ|TIMESTAMP_NTZ|TIMESTAMP_LTZ|TIMESTAMP_TZ|INTERVAL|YEAR)$/.test(
      normalized
    )
  ) {
    return 3;
  }

  // 4: Logical / Boolean types
  if (/^(BOOL|BOOLEAN|BIT|LOGICAL)$/.test(normalized)) {
    return 4;
  }

  // 5: Complex & Spatial (JSON, ARRAY, STRUCT, MAP, GEOMETRY, etc.)
  return 5;
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