/** Minimal SQL port for schema provisioning; callers retain transaction and search-path ownership. */
export interface SchemaQuery {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
