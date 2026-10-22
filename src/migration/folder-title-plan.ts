import { createHash } from "node:crypto";
import { changePaths, normalizePath } from "../path-model.ts";
import type { PathEntry } from "../contracts.ts";
import type {
  FolderLocationChange,
  FolderTitlePlanResult,
  RetainedFolderDescriptor,
  RetainedFolderLocation,
} from "./folder-title-contracts.ts";

const under = (path: string, root: string) =>
  path === root || path.startsWith(root + "/");
const key = (row: { namespace: string; legacyId: string }) =>
  JSON.stringify([row.namespace, row.legacyId]);
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (rows: readonly PathEntry[]) =>
  rows.map((row) => ({ ...row })).sort((a, b) => order(a.path, b.path));
function titleSegment(title: string): string {
  return (
    title
      .normalize("NFC")
      .replace(/[\\/%?#\u0000-\u001f\u007f]+/g, "-")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80)
      .replace(/^[ .-]+|[ .-]+$/g, "") || "Untitled"
  );
}

/** Produces a postimport CAS plan only. It never guesses a location from legacy IDs,
 * changes immutable source/ACLs, or accepts a preexisting user move as an import path. */
export function planFolderTitles(
  descriptors: readonly RetainedFolderDescriptor[],
  paths: Readonly<Record<string, readonly PathEntry[]>>,
): FolderTitlePlanResult {
  const conflict = (
    reason:
      | "invalid-inventory"
      | "stale-location"
      | "invalid-path"
      | "collision",
  ): FolderTitlePlanResult => ({ kind: "conflict", reason });
  const inventory = new Map<string, RetainedFolderDescriptor>();
  const sourcePaths = new Set<string>();
  for (const row of descriptors) {
    if (
      !row.namespace ||
      !row.legacyId ||
      !row.owner ||
      !row.sourceRevision ||
      inventory.has(key(row))
    )
      return conflict("invalid-inventory");
    inventory.set(key(row), row);
    if (!row.deleted) {
      if (!row.expectedPath) return conflict("invalid-inventory");
      const pathKey = JSON.stringify([row.owner, row.expectedPath]);
      if (sourcePaths.has(pathKey)) return conflict("invalid-inventory");
      sourcePaths.add(pathKey);
    }
  }
  // Exact ancestor chains rule out cycles, missing parents and cross-owner placement.
  for (const row of descriptors) {
    for (let i = 0; i < row.ancestorIds.length; i++) {
      const id = row.ancestorIds[i]!;
      const parent = inventory.get(
        key({ namespace: row.namespace, legacyId: id }),
      );
      if (
        id === row.legacyId ||
        !parent ||
        parent.owner !== row.owner ||
        parent.deleted ||
        JSON.stringify(parent.ancestorIds) !==
          JSON.stringify(row.ancestorIds.slice(0, i))
      )
        return conflict("invalid-inventory");
    }
  }
  const owners = [
    ...new Set(descriptors.filter((r) => !r.deleted).map((r) => r.owner)),
  ].sort(order);
  const expected: Record<string, PathEntry[]> = {};
  const result: Record<string, PathEntry[]> = {};
  try {
    for (const owner of owners) {
      const entries = paths[owner] || [];
      if (new Set(entries.map((e) => e.path)).size !== entries.length)
        return conflict("invalid-inventory");
      for (const entry of entries)
        if (normalizePath(entry.path) !== entry.path)
          return conflict("invalid-path");
      expected[owner] = sorted(entries);
      result[owner] = sorted(entries);
    }
    for (const row of descriptors.filter((r) => !r.deleted)) {
      const path = row.expectedPath!;
      if (normalizePath(path) !== path) return conflict("invalid-path");
      if (
        !expected[row.owner]!.some((e) => e.path === path && e.fileId === null)
      )
        return conflict("stale-location");
      const parentId = row.ancestorIds.at(-1);
      if (parentId) {
        const parent = inventory.get(
          key({ namespace: row.namespace, legacyId: parentId }),
        )!;
        if (path.slice(0, path.lastIndexOf("/")) !== parent.expectedPath)
          return conflict("invalid-inventory");
      }
    }
  } catch {
    return conflict("invalid-path");
  }
  const changes: { owner: string; from: string; path: string }[] = [];
  const locations: RetainedFolderLocation[] = [];
  const ordered = [...descriptors].sort(
    (a, b) =>
      a.ancestorIds.length - b.ancestorIds.length || order(key(a), key(b)),
  );
  for (const row of ordered) {
    const identity = {
      namespace: row.namespace,
      legacyId: row.legacyId,
      owner: row.owner,
      sourceRevision: row.sourceRevision,
    };
    if (row.deleted) {
      locations.push({ ...identity, state: "deleted" });
      continue;
    }
    let from = row.expectedPath!;
    for (const change of changes)
      if (change.owner === row.owner && under(from, change.from))
        from = change.path + from.slice(change.from.length);
    const prefix = from.slice(0, from.lastIndexOf("/"));
    const segment = titleSegment(row.title);
    const sameTitle = ordered.some(
      (other) =>
        !other.deleted &&
        key(other) !== key(row) &&
        other.owner === row.owner &&
        other.expectedPath!.slice(0, other.expectedPath!.lastIndexOf("/")) ===
          row.expectedPath!.slice(0, row.expectedPath!.lastIndexOf("/")) &&
        titleSegment(other.title) === segment,
    );
    const hash = createHash("sha256").update(key(row)).digest("hex");
    let chosen: string | undefined;
    for (const size of sameTitle ? [8, 16, 32, 64] : [0, 8, 16, 32, 64]) {
      const target =
        prefix + "/" + segment + (size ? "-" + hash.slice(0, size) : "");
      try {
        normalizePath(target);
        const next = changePaths(result[row.owner]!, {
          kind: "move",
          from,
          path: target,
        });
        result[row.owner] = sorted(next);
        chosen = target;
        break;
      } catch {
        /* Try a stable disambiguating suffix; never replace an occupant. */
      }
    }
    if (!chosen) return conflict("collision");
    if (chosen !== from) changes.push({ owner: row.owner, from, path: chosen });
    locations.push({ ...identity, state: "live", path: chosen });
  }
  return { kind: "ready", expected, result, changes, locations };
}

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
