import { createHash } from "node:crypto";
import type { NativeIdentityImport, NativeIdentityUser } from "./contracts";
export function nativeIdentityDigest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
const normalizedEmail = (value: string | null) =>
  value?.trim().toLowerCase() ?? null;
/** PostgreSQL microseconds survive comparison; Date is used only for whole seconds and timezone conversion. */
export function nativeIdentityTimestamp(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) throw Error("native_identity_timestamp_invalid");
  const second = new Date(match[1]!.replace(" ", "T") + match[3]!);
  if (!Number.isFinite(second.getTime()))
    throw Error("native_identity_timestamp_invalid");
  return second
    .toISOString()
    .replace(".000Z", "." + (match[2] ?? "").padEnd(6, "0") + "Z");
}
export function storedUser(row: NativeIdentityUser) {
  return {
    id: row.id,
    email: row.email,
    kind: row.kind,
    parent_user_id: row.parent_user_id ?? null,
    merged_into_user_id: row.merged_into_user_id ?? null,
    expires_at: row.expires_at ? nativeIdentityTimestamp(row.expires_at) : null,
    created_at: nativeIdentityTimestamp(row.created_at),
    name: row.name ?? null,
    username: row.username ?? null,
    image_key: row.image_key ?? null,
  };
}
export function verifyNativeIdentityInput(input: NativeIdentityImport) {
  const { sha256, ...body } = input.plan;
  if (
    !/^[a-f0-9]{64}$/.test(input.approvedPlanSha256) ||
    sha256 !== input.approvedPlanSha256 ||
    nativeIdentityDigest(body) !== sha256 ||
    input.plan.blockers.length ||
    !input.plan.sourceNamespace ||
    !Number.isFinite(Date.parse(input.revokedAt))
  )
    throw Error("native_identity_plan_invalid");
  if (
    nativeIdentityDigest(input.sourceInventory) !==
      input.plan.sourceInventorySha256 ||
    nativeIdentityDigest(input.targetInventory) !==
      input.plan.targetInventorySha256
  )
    throw Error("native_identity_inventory_invalid");
  const unique = <T extends { id: string }>(rows: readonly T[]) => {
    const map = new Map<string, T>();
    for (const r of rows) {
      if (!r.id || map.has(r.id))
        throw Error("native_identity_inventory_ambiguous");
      map.set(r.id, r);
    }
    return map;
  };
  const users = unique(input.sourceInventory.users),
    tokens = unique(input.sourceInventory.tokens),
    targets = unique(input.targetInventory.users);
  const seen = new Set<string>();
  for (const mapping of input.plan.users) {
    if (seen.has(mapping.sourceId)) throw Error("native_identity_duplicate");
    seen.add(mapping.sourceId);
    const source = users.get(mapping.sourceId);
    if (source && !["account", "guest", "testuser"].includes(source.kind))
      throw Error("native_identity_source_kind_invalid");
    if (
      !source ||
      nativeIdentityDigest(source) !== mapping.sourceRowSha256 ||
      input.plan.targets.users[mapping.sourceId]?.userId !== mapping.targetId
    )
      throw Error("native_identity_user_proof_invalid");
    if (mapping.action === "reuse-verified-email") {
      const target = targets.get(mapping.targetId);
      if (
        source.kind !== "account" ||
        !source.email ||
        !target ||
        target.kind !== "account" ||
        target.merged_into_user_id ||
        (target.expires_at &&
          (!Number.isFinite(Date.parse(target.expires_at)) ||
            Date.parse(target.expires_at) <= Date.parse(input.revokedAt))) ||
        normalizedEmail(source.email) !== normalizedEmail(target.email) ||
        nativeIdentityDigest(target) !== mapping.targetRowSha256
      )
        throw Error("native_identity_reuse_invalid");
    } else if (
      mapping.action !== "create-preserved" ||
      mapping.targetId !== mapping.sourceId
    )
      throw Error("native_identity_user_id_changed");
  }
  for (const created of input.plan.createUsers) {
    const source = users.get(created.sourceId),
      mapping = input.plan.users.find((m) => m.sourceId === created.sourceId);
    if (
      !source ||
      mapping?.action !== "create-preserved" ||
      created.id !== source.id ||
      created.sourceRowSha256 !== mapping.sourceRowSha256
    )
      throw Error("native_identity_create_invalid");
    const expected = { ...source, email: normalizedEmail(source.email) };
    for (const key of ["parent_user_id", "merged_into_user_id"] as const) {
      const ref = expected[key];
      if (ref) {
        const mapped = input.plan.targets.users[ref];
        if (!mapped) throw Error("native_identity_reference_unmapped");
        expected[key] = mapped.userId;
      }
    }
    if (
      nativeIdentityDigest(storedUser(expected)) !==
      nativeIdentityDigest(storedUser(created))
    )
      throw Error("native_identity_create_changed");
  }
  if (
    input.plan.createUsers.length !==
    input.plan.users.filter((m) => m.action === "create-preserved").length
  )
    throw Error("native_identity_create_missing");
  seen.clear();
  for (const mapping of input.plan.tokens) {
    if (seen.has(mapping.sourceId)) throw Error("native_identity_duplicate");
    seen.add(mapping.sourceId);
    const source = tokens.get(mapping.sourceId);
    if (
      !source ||
      mapping.action !== "create-disabled-provenance" ||
      mapping.targetId !== mapping.sourceId ||
      nativeIdentityDigest(source) !== mapping.sourceRowSha256 ||
      input.plan.targets.tokens[mapping.sourceId]?.tokenId !==
        mapping.targetId ||
      mapping.userId !==
        (source.user_id
          ? input.plan.targets.users[source.user_id]?.userId
          : null) ||
      mapping.sourceCreatedAt !== (source.created_at ?? null) ||
      mapping.sourceDeletedAt !== (source.deleted_at ?? null) ||
      mapping.sourceExpiresAt !== (source.expires_at ?? null)
    )
      throw Error("native_identity_token_proof_invalid");
  }
  return { users, tokens, targets };
}
