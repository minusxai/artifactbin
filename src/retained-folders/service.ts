import { pathLock } from "../persistence/paths.js";
import type { AccessPolicy } from "../contracts.ts";
import type { SqlDatabase } from "../persistence/sql.ts";
import type { RetainedFolderPage, RetainedFolderService } from "./contracts.ts";
import { loadSession } from "../persistence/document-records.ts";
import { accountActor } from "../server/identity-policy.ts";
import { permissions } from "../access.ts";
import { hash, documentTitle } from "../server/text.ts";
import { fail } from "../errors.ts";

/** Read-only folder projection. A folder grant never confers child read/write authority. */
export function createRetainedFolderService(
  database: SqlDatabase,
  now = Date.now,
): RetainedFolderService {
  return {
    read: (legacyId, credential, namespace) =>
      database.transaction(async (client) => {
        const session = credential
          ? await loadSession(client, hash(credential))
          : null;
        const actor = credential ? accountActor(session, now()) : null;
        const candidates = (
          await client.query(
            "SELECT r.*,a.principal_kind FROM retained_folders r JOIN accounts a ON a.actor=r.owner WHERE r.legacy_id=$1 AND ($2::text IS NULL OR r.namespace=$2) AND r.state='live' LIMIT 2",
            [legacyId, namespace ?? null],
          )
        ).rows;
        if (candidates.length !== 1) return null;
        const selectedOwner = String(candidates[0]!.owner);
        // Match mutation lock order: path lock before folder/file row locks.
        await pathLock(client, selectedOwner);
        const rows = (
          await client.query(
            "SELECT r.*,a.principal_kind FROM retained_folders r JOIN accounts a ON a.actor=r.owner WHERE r.legacy_id=$1 AND ($2::text IS NULL OR r.namespace=$2) AND r.state='live' LIMIT 2 FOR SHARE OF r",
            [legacyId, namespace ?? null],
          )
        ).rows;
        if (rows.length !== 1 || rows[0]!.owner !== selectedOwner) return null;
        const folder = rows[0]!;
        const readable = (row: Record<string, unknown>, link: boolean) =>
          permissions(
            {
              owner: String(row.owner),
              ownerKind: row.principal_kind === "group" ? "group" : "user",
              access: row.access as AccessPolicy,
            },
            actor,
            link,
            false,
            session?.groupAuthority,
          ).read;
        if (!readable(folder, true)) return null;
        const owner = String(folder.owner),
          path = String(folder.path);
        const children = (
          await client.query(
            "SELECT f.id,f.owner,f.path,f.access,a.principal_kind,left(s.content,8192) AS content FROM files f JOIN accounts a ON a.actor=f.owner JOIN sources s ON s.file_id=f.id AND s.revision=f.head WHERE f.owner=$1 AND f.deleted_at IS NULL AND left(f.path,length($2)+1)=$2||'/' AND strpos(substr(f.path,length($2)+2),'/')=0 ORDER BY f.id LIMIT 501 FOR SHARE OF f",
            [owner, path],
          )
        ).rows;
        const related = (
          await client.query(
            "SELECT r.*,a.principal_kind FROM retained_folders r JOIN accounts a ON a.actor=r.owner WHERE r.owner=$1 AND r.state='live' AND ((left(r.path,length($2)+1)=$2||'/' AND strpos(substr(r.path,length($2)+2),'/')=0) OR left($2,length(r.path)+1)=r.path||'/') ORDER BY r.path LIMIT 501 FOR SHARE OF r",
            [owner, path],
          )
        ).rows;
        if (children.length > 500 || related.length > 500)
          fail(503, "Folder listing is too large");
        // Public children are discoverable; unlisted/private children require their own named/owner role.
        const discoverable = (row: Record<string, unknown>) =>
          (row.access as AccessPolicy).visibility === "public" ||
          readable(row, false);
        const page: RetainedFolderPage = {
          id: legacyId,
          title: String(folder.title),
          trail: related
            .filter(
              (row) =>
                path.startsWith(String(row.path) + "/") && discoverable(row),
            )
            .map((row) => ({
              id: String(row.legacy_id),
              title: String(row.title),
              url: "/a/" + encodeURIComponent(String(row.legacy_id)),
            })),
          rows: [
            ...related
              .filter(
                (row) =>
                  String(row.path).startsWith(path + "/") && discoverable(row),
              )
              .map((row) => ({
                id: String(row.legacy_id),
                title: String(row.title),
                kind: "folder" as const,
                url: "/a/" + encodeURIComponent(String(row.legacy_id)),
              })),
            ...children
              .filter((row) =>
                discoverable({
                  ...row,
                  access: row.access ?? {
                    visibility: "unlisted",
                    linkRole: "commenter",
                    shares: {},
                    version: 0,
                  },
                }),
              )
              .map((row) => ({
                id: String(row.id),
                title: documentTitle(String(row.content)),
                kind: "page" as const,
                url: "/a/" + encodeURIComponent(String(row.id)),
              })),
          ],
        };
        return page;
      }),
  };
}
