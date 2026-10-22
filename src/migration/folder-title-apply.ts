import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SqlDatabase } from "../persistence/sql.ts";
import type {
  FolderTitlePlan,
  RetainedFolderRegistration,
  RetainedFolderExecutor,
} from "../retained-folders/contracts.ts";
import { planFolderTitles } from "./folder-title-plan.ts";
import { pathLock, readPaths, writeFolders } from "../persistence/paths.js";
import { fail } from "../errors.ts";
function validAccess(policy: RetainedFolderRegistration["access"]): boolean {
  const roles = ["viewer", "commenter", "editor"];
  return (
    !!policy &&
    ["public", "unlisted", "private"].includes(policy.visibility) &&
    roles.includes(policy.linkRole) &&
    Number.isSafeInteger(policy.version) &&
    policy.version >= 0 &&
    !!policy.shares &&
    !Array.isArray(policy.shares) &&
    Object.values(policy.shares).every((role) => roles.includes(role))
  );
}
const ordered = (entries: readonly { path: string; fileId: string | null }[]) =>
  [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
/** No HTTP capability exposes this executor. It requires verified source/ACL registrations. */
export function createRetainedFolderExecutor(
  database: SqlDatabase,
): RetainedFolderExecutor {
  return async (
    plan: FolderTitlePlan,
    registrations: readonly RetainedFolderRegistration[],
  ): Promise<"applied" | "already-applied" | "stale"> => {
    if (
      registrations.some((row) => !validAccess(row.access)) ||
      !isDeepStrictEqual(
        planFolderTitles(
          registrations.map((row) => row.descriptor),
          plan.expected,
        ),
        plan,
      )
    )
      fail(422, "Invalid retained folder plan");
    const receipt = { plan, registrations };
    const digest = createHash("sha256")
      .update(JSON.stringify(receipt))
      .digest("hex");
    return database.transaction(async (client) => {
      for (const owner of Object.keys(plan.expected).sort())
        await pathLock(client, owner);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':retained-folder-apply',0))",
      );
      if (
        (
          await client.query(
            "SELECT digest FROM retained_folder_applications WHERE digest=$1",
            [digest],
          )
        ).rows.length
      )
        return "already-applied";
      for (const [owner, expected] of Object.entries(plan.expected))
        if (
          !isDeepStrictEqual(
            ordered(await readPaths(client, owner)),
            ordered(expected),
          )
        )
          return "stale";
      for (const row of plan.locations)
        if (
          (
            await client.query(
              "SELECT legacy_id FROM retained_folders WHERE namespace=$1 AND legacy_id=$2",
              [row.namespace, row.legacyId],
            )
          ).rows.length
        )
          return "stale";
      for (const [owner, entries] of Object.entries(plan.result)) {
        for (const entry of entries.filter((row) => row.fileId))
          await client.query(
            "UPDATE files SET path=$3 WHERE owner=$1 AND id=$2 AND deleted_at IS NULL",
            [owner, entry.fileId, entry.path],
          );
        await client.query("DELETE FROM folders WHERE owner=$1", [owner]);
        await writeFolders(client, owner, [...entries]);
      }
      for (const row of plan.locations) {
        const registration = registrations.find(
          (record) =>
            record.descriptor.namespace === row.namespace &&
            record.descriptor.legacyId === row.legacyId,
        )!;
        await client.query(
          "INSERT INTO retained_folders(namespace,legacy_id,owner,source_revision,title,access,state,path,trash_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)",
          [
            row.namespace,
            row.legacyId,
            row.owner,
            row.sourceRevision,
            registration.descriptor.title,
            JSON.stringify(registration.access),
            row.state,
            row.state === "deleted" ? null : row.path,
            row.state === "trash" ? row.trashId : null,
          ],
        );
      }
      await client.query(
        "INSERT INTO retained_folder_applications(digest,receipt) VALUES($1,$2::jsonb)",
        [digest, JSON.stringify(receipt)],
      );
      return "applied";
    });
  };
}
