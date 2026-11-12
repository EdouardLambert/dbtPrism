// src/core/styling/dataTypePalette.ts

export interface ThemeColorPair {
  dark: string;
  light: string;
}

export type DataTypeIconKind =
  // 0: Integer family (Coral Red)
  | 'smallint'
  | 'integer'
  | 'bigint'
  // 1: Float & Precision family (Blue)
  | 'decimal'
  | 'float'
  | 'money'
  // 2: Textual & Binary family (Green)
  | 'text'
  | 'char'
  | 'uuid'
  | 'binary'
  // 3: Date & Time family (Violet)
  | 'date'
  | 'timestamp'
  | 'timestamptz'
  | 'time'
  | 'interval'
  // 4: Logical / Boolean family (Gold / Orange)
  | 'boolean'
  | 'bit'
  // 5: Complex & Spatial family (Pink / Magenta)
  | 'json'
  | 'array'
  | 'spatial';

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
 * Maps a raw SQL data type to its specific visual subtype icon kind.
 */
export function classifyDataTypeIconKind(rawType: string): DataTypeIconKind {
  const trimmed = rawType.trim().toUpperCase();

  // Postgres / DuckDB array syntax (e.g. VARCHAR[], INT[])
  if (trimmed.endsWith('[]') || trimmed.startsWith('ARRAY') || trimmed.startsWith('LIST')) {
    return 'array';
  }

  const normalized = trimmed.replace(/\(.*\)$/, '').trim();

  // 0. Integer subtypes: smallint (12) | integer (123) | bigint (1234)
  if (/^(SMALLINT|TINYINT|INT2|BYTEINT|USMALLINT|UTINYINT|SMALLSERIAL)$/.test(normalized)) {
    return 'smallint';
  }
  if (/^(INT|INTEGER|INT4|MEDIUMINT|SERIAL|UINTEGER)$/.test(normalized)) {
    return 'integer';
  }
  if (/^(BIGINT|HUGEINT|INT8|INT16|INT32|INT64|INT128|BIGSERIAL|UBIGINT|UHUGEINT)$/.test(normalized)) {
    return 'bigint';
  }

  // 1. Float & Precision subtypes: decimal (.00) | float (1.2) | money ($)
  if (/^(DECIMAL|NUMERIC|DEC|NUMBER|BIGNUMERIC|FIXED)$/.test(normalized)) {
    return 'decimal';
  }
  if (/^(FLOAT|FLOAT4|FLOAT8|DOUBLE|DOUBLE PRECISION|REAL|BINARY_FLOAT|BINARY_DOUBLE)$/.test(normalized)) {
    return 'float';
  }
  if (/^(MONEY|SMALLMONEY|CURRENCY)$/.test(normalized)) {
    return 'money';
  }

  // 2. Textual & Binary subtypes: text (abc) | char ("a") | uuid (key) | binary (01)
  if (/^(CHAR|CHARACTER|NCHAR|BPCHAR)$/.test(normalized)) {
    return 'char';
  }
  if (/^(UUID|GUID|UNIQUEIDENTIFIER)$/.test(normalized)) {
    return 'uuid';
  }
  if (/^(BINARY|VARBINARY|BLOB|BYTEA|BYTES)$/.test(normalized)) {
    return 'binary';
  }
  if (/^(VARCHAR|CHARACTER VARYING|TEXT|STRING|NVARCHAR|CITEXT|CLOB|NAME|VARCHAR2)$/.test(normalized)) {
    return 'text';
  }

  // 3. Date & Time subtypes: date | timestamptz | timestamp | time | interval
  if (/^(DATE|YEAR)$/.test(normalized)) {
    return 'date';
  }
  if (
    /^(TIMESTAMPTZ|TIMESTAMP_TZ|TIMESTAMP_LTZ|TIMESTAMP WITH TIME ZONE|DATETIME_TZ)$/.test(
      normalized
    )
  ) {
    return 'timestamptz';
  }
  if (
    /^(TIMESTAMP|DATETIME|TIMESTAMP_NTZ|TIMESTAMP WITHOUT TIME ZONE|SMALLDATETIME)$/.test(
      normalized
    )
  ) {
    return 'timestamp';
  }
  if (/^(TIME|TIMETZ|TIME WITH TIME ZONE|TIME WITHOUT TIME ZONE)$/.test(normalized)) {
    return 'time';
  }
  if (/^(INTERVAL|DURATION)$/.test(normalized)) {
    return 'interval';
  }

  // 4. Logical / Boolean subtypes: boolean (toggle) | bit (0/1)
  if (/^(BOOL|BOOLEAN|LOGICAL)$/.test(normalized)) {
    return 'boolean';
  }
  if (/^(BIT|VARBIT|BIT VARYING)$/.test(normalized)) {
    return 'bit';
  }

  // 5. Complex & Spatial subtypes: spatial (pin) | array ([]) | json ({})
  if (
    /^(GEOMETRY|GEOGRAPHY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|SDO_GEOMETRY)$/.test(
      normalized
    )
  ) {
    return 'spatial';
  }
  if (/^(ARRAY|LIST|VECTOR)$/.test(normalized)) {
    return 'array';
  }

  return 'json';
}

/**
 * Maps a SQL data type to its category color index (0..5) in DATA_TYPE_PALETTE.
 */
export function classifyDataTypeIndex(rawType: string): number {
  const kind = classifyDataTypeIconKind(rawType);
  switch (kind) {
    case 'smallint':
    case 'integer':
    case 'bigint':
      return 0;
    case 'decimal':
    case 'float':
    case 'money':
      return 1;
    case 'text':
    case 'char':
    case 'uuid':
    case 'binary':
      return 2;
    case 'date':
    case 'timestamp':
    case 'timestamptz':
    case 'time':
    case 'interval':
      return 3;
    case 'boolean':
    case 'bit':
      return 4;
    case 'json':
    case 'array':
    case 'spatial':
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
 * Returns a short text representation of the subtype icon (used in tests/utilities).
 */
export function getDataTypeShortGlyph(dataType: string | undefined): string {
  if (!dataType) return '';
  const kind = classifyDataTypeIconKind(dataType);
  switch (kind) {
    case 'smallint':
      return '12';
    case 'integer':
      return '123';
    case 'bigint':
      return '1234';
    case 'decimal':
      return '.00';
    case 'float':
      return '1.2';
    case 'money':
      return '$';
    case 'text':
      return 'abc';
    case 'char':
      return '"a"';
    case 'uuid':
      return 'key';
    case 'binary':
      return '01';
    case 'date':
      return '📅';
    case 'timestamp':
      return '🕒';
    case 'timestamptz':
      return '🌐';
    case 'time':
      return '⏱';
    case 'interval':
      return '↔';
    case 'boolean':
      return 'toggle';
    case 'bit':
      return '0/1';
    case 'json':
      return '{ }';
    case 'array':
      return '[ ]';
    case 'spatial':
      return '📍';
  }
}