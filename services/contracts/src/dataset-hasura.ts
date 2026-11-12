/** Dataset SQL write quotas and persisted field-name reservations. */
export const DATASET_SQL_WRITE_LIMITS = {
  /** Rows one SQL statement may change; above it nothing is written. */
  rows: 100,
} as const;

/** Persisted Hasura-style column identifiers reserve these names and anything starting `__`. */
export const DATASET_RESERVED_FIELDS = ['_id', '_can', '_and', '_or', '_not', 'true', 'false', 'null'] as const;
