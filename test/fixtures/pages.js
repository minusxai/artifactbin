// Insert accounts, sessions and published pages straight into a v2 schema.
// File IDs are six characters and revisions are page versions ("1", "2", …).
/**
 * @param {{ query(text: string, values?: unknown[]): Promise<unknown> }} pool
 * @param {{
 *   accounts?: Record<string, { name?: string, image?: string }>,
 *   tokens?: Record<string, { actor: string, fileId?: string|null, generation?: number|null, expires: number, purpose?: string }>,
 *   files?: Record<string, {
 *     owner: string, path?: string|null, shareHash?: string, share?: string|null, generation?: number,
 *     head: string, sequence?: number, access?: object, seed?: object,
 *     sources: Record<string, string>,
 *     comments?: Record<string, any>,
 *     snapshots?: Record<string, any>,
 *   }>,
 * }} fixture
 */
export async function insertPages(pool, { accounts = {}, tokens = {}, files = {} }) {
  for (const [actor, account] of Object.entries(accounts))
    await pool.query(
      "INSERT INTO accounts(actor,name,image) VALUES($1,$2,$3)",
      [actor, account.name ?? null, account.image ?? null],
    );
  for (const [tokenHash, session] of Object.entries(tokens))
    await pool.query(
      "INSERT INTO sessions(token_hash,actor,file_id,generation,expires,purpose,backend_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tokenHash,
        session.actor,
        session.fileId ?? null,
        session.generation ?? null,
        session.expires,
        session.purpose ?? null,
        session.backendVersion ?? null,
      ],
    );
  for (const file of Object.values(files)) {
    const parts = (file.path ?? "").split("/").slice(1, -1);
    for (let i = 1; i <= parts.length; i++)
      await pool.query(
        "INSERT INTO folders(owner,path) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [file.owner, "/" + parts.slice(0, i).join("/")],
      );
  }
  for (const [id, file] of Object.entries(files)) {
    await pool.query(
      "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,$2,'page',true,0)",
      [id, file.owner],
    );
    await pool.query(
      "INSERT INTO files(id,owner,share_hash,generation,head,sequence,share,path,access,seed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)",
      [
        id,
        file.owner,
        file.shareHash ?? "hash",
        file.generation ?? 1,
        file.head,
        file.sequence ?? 0,
        file.share ?? null,
        file.path ?? null,
        file.access ? JSON.stringify(file.access) : null,
        file.seed ? JSON.stringify(file.seed) : null,
      ],
    );
    for (const [revision, content] of Object.entries(file.sources))
      await pool.query(
        "INSERT INTO sources(file_id,revision,content) VALUES($1,$2,$3)",
        [id, revision, content],
      );
    for (const [snapshotId, s] of Object.entries(file.snapshots ?? {}))
      await pool.query(
        "INSERT INTO snapshots(file_id,id,source_revision,schema_version,state,view,rendered) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, snapshotId, s.sourceRevision, s.schema, s.state, s.view, s.rendered ?? null],
      );
    for (const c of Object.values(file.comments ?? {}))
      await pool.query(
        "INSERT INTO comments(file_id,id,node_id,quote,body,source_revision,parent_id,app_state_id,published_by,created_at,revision,resolved,fingerprint,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [
          id,
          c.id,
          c.nodeId,
          c.quote,
          c.body,
          c.sourceRevision,
          c.parentId,
          c.appStateId,
          c.publishedBy,
          c.createdAt,
          c.revision,
          c.resolved,
          c.fingerprint,
          c.sequence,
        ],
      );
  }
}
