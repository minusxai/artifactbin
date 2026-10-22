import { translateDataset, permitsDatasetAction } from "./grants.ts";
import type { DatasetReadAuthority } from "../contracts.ts";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const scalar = (v: unknown) =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));
function predicate(v: unknown, depth = 0): boolean {
  if (!object(v) || depth > 12) return false;
  return Object.entries(v).every(([field, value]) => {
    if (field === "_and" || field === "_or")
      return (
        Array.isArray(value) && value.every((x) => predicate(x, depth + 1))
      );
    if (field === "_not") return predicate(value, depth + 1);
    if (
      !field ||
      field.startsWith("_") ||
      field.includes("\0") ||
      !object(value)
    )
      return false;
    return Object.entries(value).every(([op, x]) =>
      op === "_is_null"
        ? typeof x === "boolean"
        : op === "_in" || op === "_nin"
          ? Array.isArray(x) && x.every((y) => y !== null && scalar(y))
          : ["_eq", "_neq", "_gt", "_gte", "_lt", "_lte"].includes(op) &&
            x !== null &&
            scalar(x),
    );
  });
}
/** Strict read-side admission of mutation restrictions. They never filter legacy SELECTs. */
function tables(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > 64) return false;
  const seen = new Set<string>();
  return v.every((t) => {
    if (
      !object(t) ||
      !only(t, [
        "table",
        "insert_permissions",
        "update_permissions",
        "delete_permissions",
      ]) ||
      !object(t.table) ||
      !only(t.table, ["schema", "name"]) ||
      typeof t.table.schema !== "string" ||
      !t.table.schema ||
      typeof t.table.name !== "string" ||
      !t.table.name
    )
      return false;
    const key = JSON.stringify([t.table.schema, t.table.name]);
    if (seen.has(key)) return false;
    seen.add(key);
    return ["insert", "update", "delete"].every((op) => {
      const entries = t[op + "_permissions"];
      if (entries === undefined) return true;
      if (!Array.isArray(entries) || entries.length > 1) return false;
      return entries.every((e) => {
        if (
          !object(e) ||
          !only(e, ["role", "permission", "comment"]) ||
          e.role !== "viewer" ||
          (e.comment !== undefined &&
            e.comment !== null &&
            typeof e.comment !== "string") ||
          !object(e.permission)
        )
          return false;
        const p = e.permission;
        if (
          !only(
            p,
            op === "delete"
              ? ["filter", "backend_only"]
              : op === "insert"
                ? ["columns", "check", "set", "backend_only"]
                : ["columns", "filter", "check", "set", "backend_only"],
          ) ||
          (p.backend_only !== undefined && p.backend_only !== false)
        )
          return false;
        if (op !== "insert" && !predicate(p.filter)) return false;
        if (
          (op === "insert" ||
            (op === "update" && p.check !== undefined && p.check !== null)) &&
          !predicate(p.check)
        )
          return false;
        if (op === "update" && p.columns === undefined) return false;
        if (
          p.columns !== undefined &&
          p.columns !== "*" &&
          (!Array.isArray(p.columns) ||
            new Set(p.columns).size !== p.columns.length ||
            p.columns.some(
              (c) => typeof c !== "string" || !c || c.includes("\0"),
            ))
        )
          return false;
        return (
          p.set === undefined ||
          (object(p.set) &&
            Object.entries(p.set).every(
              ([k, v]) => !!k && !k.includes("\0") && scalar(v),
            ))
        );
      });
    });
  });
}
export function legacyAudienceReadable(
  row: {
    id: string;
    owner: {
      userId: string | null;
      tokenId: string | null;
      groupId?: string | null;
    };
    visibility: string;
  },
  facts: DatasetReadAuthority["facts"],
): boolean {
  if (!["private", "public", "unlisted"].includes(row.visibility)) return false;
  const { owner } = row;
  const caller = facts.caller;
  const group = owner.groupId;
  const role =
    group && Object.hasOwn(facts.groupRoles, group)
      ? facts.groupRoles[group]
      : undefined;
  const owns = group
    ? caller.groupId === group
    : owner.userId
      ? owner.userId === caller.userId
      : !!caller.tokenId && owner.tokenId === caller.tokenId;
  return (
    owns ||
    role === "editor" ||
    role === "viewer" ||
    row.visibility !== "private" ||
    (!!caller.userId && facts.sharedArtifactIds.includes(row.id))
  );
}
export function datasetReadable(authority: DatasetReadAuthority): boolean {
  const { page, dataset, facts } = authority;
  if (
    dataset.deleted ||
    !["private", "public", "unlisted"].includes(dataset.visibility) ||
    page.deleted ||
    page.format !== "markup" ||
    !legacyAudienceReadable(page, facts)
  )
    return false;
  const p = dataset.policy;
  if (p === null) return legacyAudienceReadable(dataset, facts);
  if (
    !object(p) ||
    JSON.stringify(p).length > 64000 ||
    !only(
      p,
      p.version === 1
        ? ["version", "enforcement", "tables"]
        : ["version", "allow", "tables"],
    )
  )
    return false;
  if (p.version === 1)
    return (
      p.enforcement === "enabled" &&
      tables(p.tables) &&
      legacyAudienceReadable(dataset, facts)
    );
  if (p.version !== 2 || (Object.hasOwn(p, "tables") && !tables(p.tables)))
    return false;
  const translated = translateDataset({
    ...dataset,
    policy: { version: 2, allow: p.allow },
  });
  return (
    translated.ok &&
    permitsDatasetAction(translated.dataset, {
      action: "read",
      facts,
      currentPolicyRevision: dataset.policyRevision,
      document: page,
    })
  );
}
