import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Queryable } from "@artifactbin/contracts";
import {
  nativeIdentityDigest,
  nativeIdentityTimestamp,
} from "../native-identity-import";
import type {
  NativeArtifactRelationRow,
  NativeArtifactRelations,
  NativeArtifactRelationsInput,
} from "./artifact-relation-contracts";
import type { NativeHistoryImport } from "./contracts";
const fail = (): never => {
  throw Error("native_artifact_relation_mismatch");
};
const authorities = new WeakMap<
  object,
  NativeArtifactRelationsInput["history"]
>();
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : fail());
const parse = (v: Uint8Array) =>
  object(JSON.parse(Buffer.from(v).toString("utf8")));
const columns = [
  "subject_kind",
  "subject_id",
  "verb",
  "object_kind",
  "object_id",
  "created_at",
  "deleted_at",
  "status",
  "direction",
  "initiated_by",
  "explicit_join",
  "accepted_at",
  "revision",
];
const key = (r: NativeArtifactRelationRow) =>
  JSON.stringify([
    r.subject_kind,
    r.subject_id,
    r.verb,
    r.object_kind,
    r.object_id,
  ]);
function normalize(value: unknown): NativeArtifactRelationRow {
  const r = object(value);
  if (
    !isDeepStrictEqual(Object.keys(r).sort(), [...columns].sort()) ||
    r.subject_kind !== "user" ||
    r.object_kind !== "artifact" ||
    !["join", "like"].includes(String(r.verb)) ||
    !["accepted", "pending", "left", "dismissed"].includes(String(r.status)) ||
    !["request", "invitation"].includes(String(r.direction)) ||
    typeof r.subject_id !== "string" ||
    !r.subject_id ||
    typeof r.object_id !== "string" ||
    !r.object_id ||
    !(
      r.initiated_by === null ||
      (typeof r.initiated_by === "string" && r.initiated_by.length > 0)
    ) ||
    typeof r.explicit_join !== "boolean" ||
    !Number.isSafeInteger(r.revision) ||
    Number(r.revision) < 1
  )
    return fail();
  for (const c of ["created_at", "accepted_at", "deleted_at"]) {
    if (r[c] === null && c !== "created_at") continue;
    if (typeof r[c] !== "string") return fail();
    r[c] = nativeIdentityTimestamp(r[c] as string);
  }
  return r as unknown as NativeArtifactRelationRow;
}
function sorted(rows: NativeArtifactRelationRow[]) {
  return rows.sort((a, b) => key(a).localeCompare(key(b)));
}
function readonlySnapshot(value: Record<string, unknown>) {
  const snapshots = array(value.snapshot);
  if (!snapshots.length || snapshots.some((s) => object(s).read_only !== "on"))
    fail();
}
export function assertNativeArtifactRelations(
  adapter: NativeArtifactRelations,
  history: Pick<
    NativeHistoryImport,
    | "sourceNamespace"
    | "sourceId"
    | "pageId"
    | "selectionSha256"
    | "projectionSha256"
    | "headVersion"
  >,
): void {
  const proof = authorities.get(adapter);
  if (
    !proof ||
    !isDeepStrictEqual(proof, {
      sourceNamespace: history.sourceNamespace,
      sourceId: history.sourceId,
      pageId: history.pageId,
      selectionSha256: history.selectionSha256,
      projectionSha256: history.projectionSha256,
      headVersion: history.headVersion,
    })
  )
    fail();
}
/** Migration-only source receipt admission. No live source access and no authored capability or inferred membership. */
export function prepareNativeArtifactRelations(
  raw: NativeArtifactRelationsInput,
): NativeArtifactRelations {
  const input = structuredClone(raw),
    { source, approved, identityPlan } = input;
  const history = {
    sourceNamespace: input.history.sourceNamespace,
    sourceId: input.history.sourceId,
    pageId: input.history.pageId,
    selectionSha256: input.history.selectionSha256,
    projectionSha256: input.history.projectionSha256,
    headVersion: input.history.headVersion,
  };
  for (const [value, digest] of [
    [source.capture, approved.captureSha256],
    [source.selectionManifest, approved.selectionManifestSha256],
    [source.headWitness, approved.headWitnessSha256],
  ] as const)
    if (!/^[a-f0-9]{64}$/.test(digest) || hash(value) !== digest) fail();
  const { sha256, ...planBody } = identityPlan;
  if (
    sha256 !== approved.identityPlanSha256 ||
    nativeIdentityDigest(planBody) !== sha256 ||
    identityPlan.blockers.length ||
    identityPlan.sourceNamespace !== history.sourceNamespace ||
    history.selectionSha256 !== approved.selectionManifestSha256
  )
    fail();
  const manifest = parse(source.selectionManifest),
    receipts = new Map<string, Record<string, unknown>>();
  for (const r of array(manifest.receipts)) {
    const receipt = object(r);
    if (typeof receipt.id !== "string" || receipts.has(receipt.id)) fail();
    receipts.set(receipt.id as string, receipt);
  }
  if (!receipts.size || !receipts.has(history.sourceId)) fail();
  const selected = new Set(receipts.keys()),
    artifacts = object(identityPlan.artifactIds),
    targets = new Set<string>();
  for (const id of selected) {
    const target = artifacts[id];
    if (typeof target !== "string" || !target || targets.has(target)) fail();
    targets.add(target as string);
  }
  if (artifacts[history.sourceId] !== history.pageId) fail();
  if (source.refreshManifest || approved.refreshManifestSha256) {
    if (
      !source.refreshManifest ||
      !approved.refreshManifestSha256 ||
      hash(source.refreshManifest) !== approved.refreshManifestSha256
    )
      fail();
    const refresh = parse(source.refreshManifest!);
    if (
      refresh.format !== "native-latest-two-head-refresh-v1" ||
      refresh.revisionScope !== "latest" ||
      refresh.selectionUnchanged !== true ||
      refresh.productionWrites !== false ||
      refresh.priorManifestSha256 !== approved.selectionManifestSha256 ||
      refresh.originalSelectionCount !== selected.size
    )
      fail();
    const updated = new Set<string>();
    for (const value of array(refresh.receipts)) {
      const r = object(value),
        id = r.id;
      if (
        typeof id !== "string" ||
        !selected.has(id) ||
        updated.has(id) ||
        !isDeepStrictEqual(r.priorReceipt, receipts.get(id)) ||
        r.revisionScope !== "latest"
      )
        fail();
      updated.add(id as string);
      receipts.set(id as string, r);
    }
    if (
      !updated.size ||
      !isDeepStrictEqual(
        [...updated].sort(),
        array(refresh.invalidatedSourceIds).sort(),
      )
    )
      fail();
  }
  const canonical = parse(source.canonicalSource),
    receipt = receipts.get(history.sourceId)!;
  if (
    hash(source.canonicalSource) !== receipt.sha256 ||
    source.canonicalSource.byteLength !== receipt.bytes ||
    receipt.expectedVersion !== history.headVersion
  )
    fail();
  const heads = array(canonical.heads);
  if (heads.length !== 1) fail();
  const head = object(heads[0]);
  if (
    head.id !== history.sourceId ||
    head.version !== history.headVersion ||
    typeof head.edit_id !== "string" ||
    !head.edit_id
  )
    fail();
  const witness = parse(source.headWitness);
  readonlySnapshot(witness);
  const witnessed = new Map<string, Record<string, unknown>>();
  for (const v of array(witness.relations)) {
    const row = object(v);
    if (
      typeof row.id !== "string" ||
      !selected.has(row.id) ||
      witnessed.has(row.id)
    )
      fail();
    witnessed.set(row.id as string, row);
  }
  if (
    witnessed.size !== selected.size ||
    witnessed.get(history.sourceId)?.version !== head.version ||
    witnessed.get(history.sourceId)?.edit_id !== head.edit_id
  )
    fail();
  const users = new Map<string, string>(),
    userTargets = new Set<string>();
  for (const mapping of identityPlan.users) {
    if (
      !mapping.sourceId ||
      !mapping.targetId ||
      users.has(mapping.sourceId) ||
      userTargets.has(mapping.targetId) ||
      identityPlan.targets.users[mapping.sourceId]?.userId !== mapping.targetId
    )
      fail();
    users.set(mapping.sourceId, mapping.targetId);
    userTargets.add(mapping.targetId);
  }
  const capture = parse(source.capture);
  readonlySnapshot(capture);
  const tuples = new Set<string>(),
    needed = new Map<string, string>();
  const rows: NativeArtifactRelationRow[] = [];
  for (const value of array(capture.relations)) {
    const row = normalize(value),
      tuple = key(row);
    if (
      !selected.has(row.object_id) ||
      tuples.has(tuple) ||
      !users.has(row.subject_id) ||
      (row.initiated_by !== null && !users.has(row.initiated_by))
    )
      fail();
    tuples.add(tuple);
    if (row.object_id !== history.sourceId) continue;
    needed.set(row.subject_id, users.get(row.subject_id)!);
    if (row.initiated_by)
      needed.set(row.initiated_by, users.get(row.initiated_by)!);
    rows.push({
      ...row,
      subject_id: users.get(row.subject_id)!,
      object_id: history.pageId,
      initiated_by:
        row.initiated_by === null ? null : users.get(row.initiated_by)!,
    });
  }
  sorted(rows);
  const sourceSha256 = nativeIdentityDigest({
    history,
    approved,
    canonicalSourceSha256: hash(source.canonicalSource),
    rows,
  });
  async function scope(tx: Queryable, pageId: string) {
    if (pageId !== history.pageId) fail();
    const savedRow = (
        await tx.query<{ receipt: Record<string, unknown>; version: number }>(
          "SELECT meta->'nativeImport' AS receipt,version FROM artifacts WHERE id=$1 FOR UPDATE",
          [pageId],
        )
      ).rows[0],
      saved = savedRow?.receipt;
    if (
      !saved ||
      savedRow?.version !== history.headVersion ||
      [
        "sourceNamespace",
        "sourceId",
        "selectionSha256",
        "projectionSha256",
      ].some((k) => saved[k] !== history[k as keyof typeof history])
    )
      fail();
    for (const [sourceId, targetId] of needed) {
      const records = (
        await tx.query<{
          target_id: string;
          projection_sha256: string;
          user_id: string;
        }>(
          "SELECT n.target_id,n.projection_sha256,u.id AS user_id FROM native_identity_imports n JOIN users u ON u.id=n.target_id WHERE n.source_namespace=$1 AND n.kind='user' AND n.source_id=$2 FOR UPDATE OF n,u",
          [history.sourceNamespace, sourceId],
        )
      ).rows;
      if (
        records.length !== 1 ||
        records[0]!.target_id !== targetId ||
        records[0]!.user_id !== targetId ||
        records[0]!.projection_sha256 !== approved.identityPlanSha256
      )
        fail();
    }
  }
  async function read(tx: Queryable, pageId: string) {
    const actual = await tx.query<{ row: unknown }>(
      "SELECT to_jsonb(r) AS row FROM relations r WHERE object_kind='artifact' AND object_id=$1 AND verb IN ('join','like') FOR UPDATE",
      [pageId],
    );
    return sorted(actual.rows.map((r) => normalize(r.row)));
  }
  const adapter = {
    sourceSha256,
    async apply(tx: Queryable, pageId: string) {
      await scope(tx, pageId);
      const actual = await read(tx, pageId);
      if (isDeepStrictEqual(actual, rows)) return;
      if (actual.length) fail();
      for (const row of rows)
        await tx.query(
          `INSERT INTO relations (${columns.join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
          columns.map((c) => row[c as keyof NativeArtifactRelationRow]),
        );
    },
    async verify(tx: Queryable, pageId: string) {
      await scope(tx, pageId);
      if (!isDeepStrictEqual(await read(tx, pageId), rows)) fail();
    },
  } as NativeArtifactRelations;
  authorities.set(adapter, history);
  return Object.freeze(adapter);
}
