import type { SqlClient } from "../persistence/sql.ts";
import type { PathChange } from "../contracts.ts";
import type {
  FolderLocationChange,
  RetainedFolderLocation,
} from "./contracts.ts";
import { changeFolderLocations } from "./model.ts";
import { normalizePath } from "../path-model.ts";

function decode(row: Record<string, unknown>): RetainedFolderLocation {
  const identity = {
    namespace: String(row.namespace),
    legacyId: String(row.legacy_id),
    owner: String(row.owner),
    sourceRevision: String(row.source_revision),
  };
  return row.state === "live"
    ? { ...identity, state: "live", path: String(row.path) }
    : row.state === "trash"
      ? {
          ...identity,
          state: "trash",
          path: String(row.path),
          trashId: String(row.trash_id),
        }
      : { ...identity, state: "deleted" };
}
/** Caller holds the owner's path lock and commits this alongside the path mutation. */
export async function updateRetainedLocations(
  client: SqlClient,
  owner: string,
  changes: readonly FolderLocationChange[],
  removed?: string,
): Promise<void> {
  const before = (
    await client.query(
      "SELECT namespace,legacy_id,owner,source_revision,state,path,trash_id FROM retained_folders WHERE owner=$1 FOR UPDATE",
      [owner],
    )
  ).rows.map(decode);
  let after = before;
  for (const change of changes) after = changeFolderLocations(after, change);
  if (removed)
    after = after.map((row) =>
      row.state === "live" && row.path === removed
        ? {
            namespace: row.namespace,
            legacyId: row.legacyId,
            owner: row.owner,
            sourceRevision: row.sourceRevision,
            state: "deleted",
          }
        : row,
    );
  for (let i = 0; i < after.length; i++) {
    const row = after[i]!;
    if (JSON.stringify(row) === JSON.stringify(before[i])) continue;
    const old = before[i]!;
    const renamed =
      row.state === "live" &&
      old.state === "live" &&
      row.path.split("/").at(-1) !== old.path.split("/").at(-1);
    await client.query(
      "UPDATE retained_folders SET state=$3,path=$4,trash_id=$5,title=COALESCE($6::text,title) WHERE namespace=$1 AND legacy_id=$2",
      [
        row.namespace,
        row.legacyId,
        row.state,
        row.state === "deleted" ? null : row.path,
        row.state === "trash" ? row.trashId : null,
        renamed && row.state === "live" ? row.path.split("/").at(-1) : null,
      ],
    );
  }
}
export function syncRetainedPathChange(
  client: SqlClient,
  owner: string,
  change: PathChange,
): Promise<void> {
  if (change.kind === "move")
    return updateRetainedLocations(client, owner, [
      {
        kind: "move",
        owner,
        from: normalizePath(change.from),
        path: normalizePath(change.path),
      },
    ]);
  if (change.kind === "remove-folder")
    return updateRetainedLocations(
      client,
      owner,
      [],
      normalizePath(change.path),
    );
  if (change.kind !== "move-many") return Promise.resolve();
  const paths = [...new Set(change.paths.map((path) => normalizePath(path)))];
  const roots = paths.filter(
    (path) =>
      !paths.some((other) => other !== path && path.startsWith(other + "/")),
  );
  const destination = normalizePath(change.destination, true);
  return updateRetainedLocations(
    client,
    owner,
    roots.map((from) => ({
      kind: "move" as const,
      owner,
      from,
      path:
        (destination === "/" ? "" : destination) +
        from.slice(from.lastIndexOf("/")),
    })),
  );
}
