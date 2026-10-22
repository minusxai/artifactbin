import type { ValidateDatasetUserWrites } from "../datasets/mutation/repository-contracts.ts";
import { DatasetMutationError } from "../datasets/mutation/contracts.ts";
import { selectDatasetMutationPolicy } from "../datasets/mutation/policy.ts";
import type { DatasetReadAuthority } from "../datasets/contracts.ts";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function deny(): never {
  throw new DatasetMutationError("denied");
}
import { validateUserAssignments } from "../datasets/mutation/user-writes.ts";
export const validateDatasetUserWrites: ValidateDatasetUserWrites = async (
  client,
  reg,
  head,
  outcome,
  now,
) => {
  const table = head.tables.find(
    (t) =>
      t.schema === reg.operation.target.schema &&
      t.name === reg.operation.target.table,
  );
  if (!table) deny();
  const columns = table.columns.filter((c) => c.type === "user");
  if (!columns.length) return;
  const writes = outcome.userWrites;
  if (!Array.isArray(writes) || writes.length > outcome.affected) deny();
  const selected = selectDatasetMutationPolicy(head, reg.operation),
    op = outcome.analysis!.operation;
  const permission = selected.policy?.table as unknown as
    | Record<string, unknown>
    | undefined;
  const entries = permission?.[op + "_permissions"];
  const roleEntry = Array.isArray(entries)
    ? entries.find(
        (entry) => object(entry) && entry.role === selected.policy?.role,
      )
    : undefined;
  const presets =
    object(roleEntry) &&
    object(roleEntry.permission) &&
    object(roleEntry.permission.set)
      ? Object.keys(roleEntry.permission.set)
      : [];
  const expected =
    op === "delete"
      ? []
      : columns
          .filter((c) =>
            [...(outcome.analysis?.columns ?? []), ...presets].includes(c.name),
          )
          .map((c) => c.name);
  if (
    (expected.length && writes.length !== outcome.affected) ||
    (!expected.length && writes.length)
  )
    deny();
  for (const row of writes)
    if (
      !object(row) ||
      Object.keys(row).some((k) => !expected.includes(k)) ||
      expected.some((k) => !Object.hasOwn(row, k))
    )
      deny();
  const values = [
    ...new Set(
      writes
        .flatMap((row) => Object.values(row))
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const users = values.length
    ? (
        await client.query(
          "SELECT d.legacy_id,d.actor FROM dataset_principals d JOIN accounts a ON a.actor=d.actor WHERE d.source_namespace=$1 AND d.kind='user' AND d.legacy_id=ANY($2::text[]) AND a.principal_kind='user' AND (d.expires_at IS NULL OR d.expires_at>to_timestamp($3::double precision/1000)) ORDER BY d.legacy_id FOR SHARE OF d,a",
          [reg.namespace, values, now],
        )
      ).rows
    : [];
  const refs = [
    ...new Set(
      columns
        .flatMap((c) => c.constraints?.memberOf ?? [])
        .filter((x) => x.startsWith("ref:")),
    ),
  ];
  const members = new Map<string, Set<string>>();
  if (refs.length && values.length) {
    const ids = refs.map((x) => x.slice(4));
    const pages = (
      await client.query(
        "SELECT f.id,f.access,p.snapshot FROM dataset_pages p JOIN files f ON f.id=p.page_id AND f.head=p.page_version::text WHERE p.source_namespace=$1 AND p.snapshot->>'id'=ANY($2::text[]) AND f.deleted_at IS NULL ORDER BY f.id FOR SHARE OF f",
        [reg.namespace, ids],
      )
    ).rows;
    for (const p of pages) {
      const snapshot = p.snapshot as DatasetReadAuthority["page"],
        ref = "ref:" + snapshot.id;
      const joins = (
        await client.query(
          "SELECT legacy_user_id FROM dataset_page_joins WHERE page_id=$1 AND source_namespace=$2 AND legacy_user_id=ANY($3::text[]) ORDER BY legacy_user_id FOR SHARE",
          [p.id, reg.namespace, values],
        )
      ).rows;
      const allowed = members.get(ref) ?? new Set<string>();
      const shares =
        (p.access as { shares?: Record<string, string> })?.shares ?? {};
      for (const user of users)
        if (
          snapshot.owner.userId === user.legacy_id ||
          joins.some((j) => j.legacy_user_id === user.legacy_id) ||
          Object.hasOwn(shares, String(user.actor))
        )
          allowed.add(String(user.legacy_id));
      members.set(ref, allowed);
    }
    const resources = (
      await client.query(
        "SELECT legacy_id,snapshot,access FROM dataset_resources WHERE source_namespace=$1 AND legacy_id=ANY($2::text[]) AND NOT deleted ORDER BY legacy_id FOR SHARE",
        [reg.namespace, ids],
      )
    ).rows;
    for (const r of resources) {
      const allowed = members.get("ref:" + r.legacy_id) ?? new Set<string>(),
        snapshot = r.snapshot as DatasetReadAuthority["dataset"],
        shares =
          (r.access as { shares?: Record<string, string> })?.shares ?? {};
      for (const user of users)
        if (
          snapshot.owner.userId === user.legacy_id ||
          Object.hasOwn(shares, String(user.actor))
        )
          allowed.add(String(user.legacy_id));
      members.set("ref:" + r.legacy_id, allowed);
    }
  }
  validateUserAssignments(columns, writes, {
    callerUserId: head.authority.facts.caller.userId,
    knownUserIds: users.map((u) => String(u.legacy_id)),
    members,
  });
};
