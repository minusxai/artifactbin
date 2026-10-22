// @ts-check
/** @param {import('./sql.ts').SqlClient} client @param {string} owner @returns {Promise<void>} */
export async function pathLock(client, owner) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':paths:' || $1,0))",
    [owner],
  );
}
/** @param {import('./sql.ts').SqlClient} client @param {string} owner @returns {Promise<import('../contracts.ts').PathEntry[]>} */
export async function readPaths(client, owner) {
  return (
    await client.query(
      'SELECT path,id AS "fileId" FROM files WHERE owner=$1 AND deleted_at IS NULL AND path IS NOT NULL UNION ALL SELECT path,NULL AS "fileId" FROM folders WHERE owner=$1',
      [owner],
    )
  ).rows.map((row) => ({
    path: String(row.path),
    fileId: row.fileId === null ? null : String(row.fileId),
  }));
}
/** @param {import('./sql.ts').SqlClient} client @param {string} owner @param {readonly import('../contracts.ts').PathEntry[]} entries @returns {Promise<void>} */
export async function writeFolders(client, owner, entries) {
  for (const e of entries.filter((e) => !e.fileId))
    await client.query(
      "INSERT INTO folders(owner,path) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [owner, e.path],
    );
}
