/** The observed legacy list dialect only; unsupported SQL remains a conversion refusal. */
export interface LegacyDuckSqlNormalization {
  sql: string;
  changed: boolean;
}

/** Operator-audited type facts for one immutable original SQL statement.
 * distinct-string-v1 admits one grouped text-valued DISTINCT string_agg with a
 * literal separator; unsupported projections/ordering/collation remain refused.
 * This is conversion evidence, never dataset/backend write authority. */
export interface LegacyDuckSqlAdmission {
  version: "duckdb-list-v1" | "duckdb-distinct-string-v1";
  sqlSha256: string;
  listExpressions: readonly string[];
  numericExpressions: readonly string[];
}

/** Lexer spans consumed by the bounded grouped aggregate syntax tree. */
export interface LegacySqlToken { text:string; start:number; end:number; word:boolean; }
