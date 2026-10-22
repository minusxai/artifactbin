/** Native PostgreSQL timestamp identity retained beside the bounded JSON payload. */
export type SourceTimestampOid = 1114 | 1184;
export type NormalizeSourceTimestamp = (
  value: string | null,
  oid: SourceTimestampOid,
) => string | null;
