import { PUBLIC_LIBRARY_FILE_PREDICATE } from "./public-library-policy.ts";
// @ts-check
import { AF_PAGE_PATH } from "../af-contracts.ts";
import { documentTitle } from "../server/text.ts";
/** A page's canonical address on this server, relative. @param {string} id */
const address = (id) => AF_PAGE_PATH + id;
import { normalizePath } from "../path-model.ts";
/** @param {import("./sql.ts").SqlDatabase} sql @returns {import("./document-catalog-contracts.ts").DocumentCatalog} */
export function createDocumentCatalog(sql) {
  return {
    profiles: (fileId, actors) =>
      sql.transaction(async (client) => {
        const rows = (
          await client.query(
            `SELECT actor,name,image FROM accounts WHERE actor IN
        (SELECT owner FROM files WHERE id=$1 UNION SELECT published_by FROM comments WHERE file_id=$1)
        OR actor=ANY($2::text[])`,
            [fileId, actors],
          )
        ).rows;
        return Object.fromEntries(
          rows.map((r) => [
            String(r.actor),
            {
              name: String(r.name || r.actor),
              image: r.image ? String(r.image) : null,
            },
          ]),
        );
      }),
    library: (actor) =>
      sql.transaction(async (client) => {
        const rows = (
          await client.query(
            `SELECT f.id, f.path, f.head, f.access->>'visibility' AS visibility, a.space, left(s.content,8192) AS content,
        (SELECT count(*)::int FROM comments c WHERE c.file_id=f.id) AS comments
        FROM files f JOIN accounts a ON a.actor=f.owner JOIN sources s ON s.file_id=f.id AND s.revision=f.head
        WHERE f.owner=$1 AND f.deleted_at IS NULL ORDER BY f.id`,
            [actor],
          )
        ).rows;
        return rows.map((r) => ({
          fileId: String(r.id),
          path: String(r.path),
          url: address(String(r.id)),
          sourceRevision: String(r.head),
          title: documentTitle(String(r.content)),
          commentCount: Number(r.comments),
          visibility: /** @type {import("../contracts.ts").Visibility} */ (
            r.visibility || "unlisted"
          ),
        }));
      }),
    sharedLink: (id) =>
      sql.transaction(async (client) => {
        const r = (
          await client.query(
            "SELECT id FROM files WHERE id=$1 AND deleted_at IS NULL",
            [id],
          )
        ).rows[0];
        return r ? address(String(r.id)) : null;
      }),
    resolveSharedPath: (space, path) =>
      sql.transaction(async (client) => {
        return /** @type {string|null} */ (
          (
            await client.query(
              "SELECT f.id FROM files f JOIN accounts a ON a.actor=f.owner WHERE f.deleted_at IS NULL AND a.space=$1 AND f.path=$2",
              [space, normalizePath(path)],
            )
          ).rows[0]?.id || null
        );
      }),
    discover: (actor, publicOnly = false) =>
      sql.transaction(async (client) => {
        const rows = (
          await client.query(
            `SELECT f.id,f.path,f.owner,f.head,f.access->>'visibility' AS visibility,a.space,left(s.content,8192) AS content,
       (SELECT count(*)::int FROM comments c WHERE c.file_id=f.id) AS comments
       FROM files f JOIN accounts a ON a.actor=f.owner JOIN sources s ON s.file_id=f.id AND s.revision=f.head
       WHERE ${publicOnly ? PUBLIC_LIBRARY_FILE_PREDICATE : "f.deleted_at IS NULL"} AND (${publicOnly ? "TRUE" : "f.owner<>$1 AND (f.access->'shares' ? $1 OR EXISTS (SELECT 1 FROM group_memberships gm JOIN groups g ON g.owner=gm.owner WHERE gm.owner=f.owner AND gm.actor=$1 AND g.active))"}) ORDER BY f.id`,
            publicOnly ? [] : [actor],
          )
        ).rows;
        return rows.map((r) => ({
          fileId: String(r.id),
          path: String(r.path),
          url: address(String(r.id)),
          title: documentTitle(String(r.content)),
          sourceRevision: String(r.head),
          commentCount: Number(r.comments),
          visibility: /** @type {import("../contracts.ts").Visibility} */ (
            r.visibility || "unlisted"
          ),
          shared: true,
          owner: String(r.owner),
        }));
      }),
    resolvePath: (actor, path) =>
      sql.transaction(async (client) => {
        return /** @type {string|null} */ (
          (
            await client.query(
              "SELECT id FROM files WHERE owner=$1 AND path=$2 AND deleted_at IS NULL",
              [actor, normalizePath(path)],
            )
          ).rows[0]?.id || null
        );
      }),
    filePath: (actor, id) =>
      sql.transaction(async (client) => {
        return /** @type {string|null} */ (
          (
            await client.query(
              "SELECT path FROM files WHERE owner=$1 AND id=$2 AND deleted_at IS NULL",
              [actor, id],
            )
          ).rows[0]?.path || null
        );
      }),
  };
}
