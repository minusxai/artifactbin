import type { PublicProfileRepository } from "../server/public-profile-contracts.ts";
import type { SqlDatabase } from "./sql.ts";
import { handleStore, normalizeHandle } from "../server/handles.ts";
import { documentTitle } from "../server/text.ts";
import { PUBLIC_LIBRARY_FILE_PREDICATE } from "./public-library-policy.ts";
/** Owner filtering and pagination happen in SQL, before any document text leaves storage. */
export function createPublicProfileRepository(
  database: SqlDatabase,
): PublicProfileRepository {
  return {
    read: (handle, after, limit) =>
      database.transaction(async (client) => {
        const actor = await handleStore.actor(client, handle);
        if (!actor) return null;
        const rows = (
          await client.query(
            `SELECT f.id,left(s.content,8192) AS content FROM files f JOIN sources s ON s.file_id=f.id AND s.revision=f.head WHERE f.owner=$1 AND ${PUBLIC_LIBRARY_FILE_PREDICATE} AND ($2::text IS NULL OR f.id>$2) ORDER BY f.id LIMIT $3`,
            [actor, after, limit + 1],
          )
        ).rows;
        const selected = rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          title: documentTitle(String(row.content)),
        }));
        return {
          handle: normalizeHandle(handle),
          files: selected,
          next: rows.length > limit ? selected.at(-1)!.id : null,
        };
      }),
  };
}
