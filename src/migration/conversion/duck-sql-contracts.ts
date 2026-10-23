/** The observed legacy list dialect only; unsupported SQL remains a conversion refusal. */
export interface LegacyDuckSqlNormalization {
  sql: string;
  changed: boolean;
}

/** Operator-audited type facts for one immutable original SQL statement.
 * This is conversion evidence, never dataset/backend write authority. */
export interface LegacyDuckSqlAdmission {
  version: "duckdb-list-v1";
  sqlSha256: string;
  listExpressions: readonly string[];
  numericExpressions: readonly string[];
}
