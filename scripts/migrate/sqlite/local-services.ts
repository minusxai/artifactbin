/**
 * THE REHEARSAL'S ENVIRONMENT BOUNDARY: point the app at a restored database
 * and a local copy of its object store, with the query engine in process.
 *
 * The app reads its settings once, when lib/config is first imported, so a
 * script awaits this BEFORE importing any app module — which is why this and
 * the scripts beside it import the app dynamically. Nothing here reaches a
 * remote store or a separate service: a rehearsal never touches production.
 * The engine is registered the way the server's composition root does it
 * (server.ts), from the same local entry.
 */
export async function useLocalServices(options: { db: string; objects?: string }): Promise<void> {
  process.env.DATABASE_URL = options.db;
  if (options.objects) process.env.OBJECT_STORE__LOCAL_DIR = options.objects;
  for (const remote of ['S3_URL', 'SQL__SERVICE_URL', 'BROWSER__SERVICE_URL', 'EVENTS__SERVICE_URL']) delete process.env[remote];
  const [{ setServices }, { MAX_QUERY_ROWS, QUERY_TIMEOUT_MS }, { createSql }] = await Promise.all([
    import('@/lib/services'), import('@/lib/config'), import('@artifactbin/sql/local'),
  ]);
  setServices({ sql: createSql({ maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS }) });
}
