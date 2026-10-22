import type {
  FolderLocationChange,
  RetainedFolderLocation,
} from "./contracts.ts";
import { normalizePath } from "../path-model.ts";
const under = (path: string, root: string) =>
  path === root || path.startsWith(root + "/");
/** Apply with the corresponding path mutation in the same transaction. An alias
 * records identity/location only: callers must freshly authorize every lookup. */
export function changeFolderLocations(
  locations: readonly RetainedFolderLocation[],
  change: FolderLocationChange,
): RetainedFolderLocation[] {
  const root =
    change.kind === "move" || change.kind === "restore"
      ? change.from
      : change.path;
  normalizePath(root);
  if (change.kind !== "trash") normalizePath(change.path);
  return locations.map((row) => {
    if (row.owner !== change.owner || row.state === "deleted")
      return { ...row };
    if (change.kind === "restore") {
      if (
        row.state !== "trash" ||
        row.trashId !== change.trashId ||
        !under(row.path, root)
      )
        return { ...row };
      const { trashId: _receipt, ...identity } = row;
      return {
        ...identity,
        state: "live",
        path: change.path + row.path.slice(root.length),
      };
    }
    if (row.state !== "live" || !under(row.path, root)) return { ...row };
    if (change.kind === "trash")
      return { ...row, state: "trash", trashId: change.trashId };
    return { ...row, path: change.path + row.path.slice(root.length) };
  });
}
