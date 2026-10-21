export interface DestinationSchemas {
  runtime: string;
  archive: string;
}
/** PostgreSQL identifiers are at most 63 bytes; reserve 10 for `_migration`.
 * Reject system/default namespaces before connecting or issuing any SQL. */
export function destinationSchemas(base: string): DestinationSchemas {
  if (
    typeof base !== 'string' ||
    base.length > 53 ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(base) ||
    /^(?:public|information_schema)$/i.test(base) ||
    /^pg_/i.test(base)
  ) {
    throw new Error('Destination requires a dedicated ASCII schema of at most 53 characters, outside reserved namespaces');
  }
  return { runtime: '"' + base + '"', archive: '"' + base + '_migration"' };
}
