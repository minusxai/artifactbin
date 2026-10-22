import { loadGroupAuthority } from "./group-memberships.ts";
import { namespaceOwner } from "../group-authority.ts";
// @ts-check
import { changePaths } from "../path-model.ts";
import { pathLock, readPaths, writeFolders } from "./paths.js";
/** @param {import("./sql.ts").SqlDatabase} sql @returns {import("./path-catalog-contracts.ts").PathCatalog} */
export function createPathCatalog(sql) {
  return {
    paths: (actor, selected) =>
      sql.transaction(async (client) => {
        return readPaths(
          client,
          namespaceOwner(
            actor,
            selected,
            false,
            selected ? await loadGroupAuthority(client, actor) : undefined,
          ),
        );
      }),
    changePath: (actor, change) =>
      sql.transaction(async (client) => {
        await pathLock(client, actor);
        const before = await readPaths(client, actor),
          after = changePaths(before, change);
        for (const entry of after.filter((e) => e.fileId)) {
          const old = before.find((e) => e.fileId === entry.fileId);
          if (old?.path !== entry.path)
            await client.query(
              "UPDATE files SET path=$3 WHERE owner=$1 AND id=$2",
              [actor, entry.fileId, entry.path],
            );
        }
        await client.query("DELETE FROM folders WHERE owner=$1", [actor]);
        await writeFolders(client, actor, after);
        return after;
      }),
  };
}
