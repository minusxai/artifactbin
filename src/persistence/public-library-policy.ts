/** Shared anonymous discovery boundary. Unlisted and private documents never appear. */
export const PUBLIC_LIBRARY_FILE_PREDICATE =
  "f.deleted_at IS NULL AND f.access->>'visibility'='public'";
