import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import type {
  MigrationReadinessRow,
  MigrationReadiness,
} from "./dependency-contracts.ts";
const address =
  /^\/af\/v1\/ids\/([A-Za-z0-9]{6})\/assets\/[1-9][0-9]*\/(?:original|small)\/[a-f0-9]{64}$/;
export function mediaDependencies(html: string, ownId: string): string[] {
  const found = new Set<string>();
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ("attrs" in node)
      for (const attr of node.attrs) {
        if (!["src", "href", "poster", "srcset"].includes(attr.name)) continue;
        const values =
          attr.name === "srcset"
            ? attr.value.split(",").map((v) => v.trim().split(/\s/)[0]!)
            : [attr.value];
        for (const value of values)
          try {
            const path = new URL(value, "https://relative.invalid").pathname;
            const match = path.match(address);
            if (match && match[1] !== ownId) found.add(path);
          } catch {}
      }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(parse(html));
  return [...found].sort();
}
export function resolveMigrationReadiness(
  rows: readonly MigrationReadinessRow[],
): MigrationReadiness {
  const byId = new Map(rows.map((r) => [r.pageId, r]));
  if (byId.size !== rows.length)
    throw new Error("Duplicate dependency page identity");
  const ready = new Set(rows.filter((r) => r.ready).map((r) => r.pageId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (
        ready.has(row.pageId) &&
        row.dependencies.some((dependency) => {
          const match = dependency.match(address);
          const target = match?.[1] ?? dependency;
          return (
            !ready.has(target) ||
            (!!match && !byId.get(target)?.assets?.includes(dependency))
          );
        })
      ) {
        ready.delete(row.pageId);
        changed = true;
      }
  }
  const blocked: Record<string, string[]> = {};
  for (const row of rows)
    if (!ready.has(row.pageId))
      blocked[row.pageId] = row.dependencies.filter((dependency) => {
        const match = dependency.match(address);
        const target = match?.[1] ?? dependency;
        return (
          !ready.has(target) ||
          (!!match && !byId.get(target)?.assets?.includes(dependency))
        );
      });
  return { ready: [...ready].sort(), blocked };
}
