import { it, expect } from "vitest";
import { deriveNativeUserObject } from "../catalog-user-remap";
import { nativeCatalogBytes, nativeCatalogDigest } from "../catalog-digest";
import type { NativeCatalogUserTable } from "../catalog-user-remap-contracts";
function fixture() {
  const bytes = Buffer.from(
    '[ {"owner":"source-person","text":"source-person","nested":{"owner":"source-person"}}, {"owner":null}, {"owner":""} ]',
  );
  const table: NativeCatalogUserTable = {
    sourceId: "SyntheticDataset",
    version: 7,
    schema: "public",
    table: "rows",
    sourceMetaSha256: "a".repeat(64),
    sourceObjectKey: "dataset/" + nativeCatalogBytes(bytes).slice(0, 32),
    userColumns: ["owner"],
  };
  return {
    bytes,
    table,
    users: { "source-person": "target-person" },
    plan: "b".repeat(64),
  };
}
it("derives only declared user cells, preserves ordinary strings and original bytes, and binds both object/catalog proofs", () => {
  const { bytes, table, users, plan } = fixture(),
    copy = Buffer.from(bytes),
    result = deriveNativeUserObject(table, bytes, users, plan)!;
  expect(JSON.parse(result.bytes.toString())).toEqual([
    {
      owner: "target-person",
      text: "source-person",
      nested: { owner: "source-person" },
    },
    { owner: null },
    { owner: "" },
  ]);
  expect(bytes).toEqual(copy);
  expect(result.receipt.changedCells).toBe(1);
  expect(result.receipt.sourceSha256).toBe(nativeCatalogBytes(bytes));
  expect(result.receipt.targetSha256).toBe(nativeCatalogBytes(result.bytes));
  expect(result.receipt.targetKey).toBe(
    "dataset/" + nativeCatalogBytes(result.bytes).slice(0, 32),
  );
  expect(result.receipt.usersSha256).toBe(nativeCatalogDigest(users));
  expect(deriveNativeUserObject(table, bytes, users, plan)).toEqual(result);
});
it("returns no derivative when identities remain unchanged, including plain strings that happen to equal another actor", () => {
  const { bytes, table, plan } = fixture();
  expect(
    deriveNativeUserObject(
      table,
      bytes,
      { "source-person": "source-person" },
      plan,
    ),
  ).toBeNull();
  expect(
    deriveNativeUserObject(
      { ...table, userColumns: [] },
      bytes,
      { "source-person": "target-person" },
      plan,
    ),
  ).toBeNull();
});
it("rejects missing user mappings, invalid typed cells, invalid rows and mismatched content-addressed source keys", () => {
  const { bytes, table, users, plan } = fixture();
  expect(() => deriveNativeUserObject(table, bytes, {}, plan)).toThrow();
  expect(() =>
    deriveNativeUserObject(
      {
        ...table,
        sourceObjectKey:
          "dataset/" +
          nativeCatalogBytes(Buffer.from('[{"owner":1}]')).slice(0, 32),
      },
      Buffer.from('[{"owner":1}]'),
      users,
      plan,
    ),
  ).toThrow();
  expect(() =>
    deriveNativeUserObject(
      {
        ...table,
        sourceObjectKey:
          "dataset/" + nativeCatalogBytes(Buffer.from("[null]")).slice(0, 32),
      },
      Buffer.from("[null]"),
      users,
      plan,
    ),
  ).toThrow();
  expect(() =>
    deriveNativeUserObject(
      { ...table, sourceObjectKey: "dataset/" + "0".repeat(32) },
      bytes,
      users,
      plan,
    ),
  ).toThrow();
});

async function stagedFixture() {
  const { stageNativeCatalog } = await import("../catalog-objects");
  const { remapNativeCatalogMetadata, nativeCatalogUserTables } =
    await import("../catalog-user-remap");
  const bytes = Buffer.from(
      '[{"owner":"source-person","text":"source-person"}]',
    ),
    key = "dataset/" + nativeCatalogBytes(bytes).slice(0, 32),
    columns = [
      { name: "owner", type: "user" },
      { name: "text", type: "string" },
    ],
    time = "2020-01-01T00:00:00.000Z";
  const meta = {
    catalog: {
      kind: "stored",
      defaultSchema: "public",
      refreshSeconds: 0,
      tables: [{ schema: "public", name: "rows", columns, objectKey: key }],
    },
    columns,
    objectKey: key,
  };
  const head = {
    id: "SyntheticData",
    edit_id: "source-edit",
    version: 1,
    format: "dataset",
    source: '<Dataset kind="stored" />',
    meta,
    title: null,
    description: null,
    token_id: "source-token",
    user_id: "source-person",
    group_id: null,
    creator_user_id: "source-person",
    actor_user_id: "source-person",
    actor_token_id: "source-token",
    visibility: "private",
    link_role: "viewer",
    access: "readwrite",
    dataset_policy: null,
    sharing_revision: 0,
    policy_revision: 0,
    ancestor_ids: [],
    created_at: time,
    updated_at: time,
    deleted_at: null,
  };
  const raw = Buffer.from(JSON.stringify({ heads: [head], versions: [] })),
    relations = Buffer.from(
      JSON.stringify({
        heads: [{ id: head.id, version: 1, updated_at: time }],
        artifact_shares: [],
        dataset_policy_audit: [],
      }),
    );
  const users = { "source-person": "target-person" },
    plan = "b".repeat(64),
    binding = nativeCatalogUserTables(meta, head.id, 1)[0]!,
    derived = deriveNativeUserObject(binding, bytes, users, plan)!;
  const dataset = {
    sourceId: head.id,
    targetId: head.id,
    sourceSha256: nativeCatalogBytes(raw),
    relationsSha256: nativeCatalogBytes(relations),
    policyAudit: [],
    currentVersion: 1,
    expectedVersions: [1],
    versions: [
      {
        version: 1,
        sourceSha256: nativeCatalogDigest(head),
        source: head.source,
        meta: remapNativeCatalogMetadata(meta, meta, head.id, 1, [
          derived.receipt,
        ]),
        title: null,
        description: null,
        createdAt: time,
        actorUserId: "target-person",
        actorTokenId: "source-token",
      },
    ],
    authority: {
      tokenId: "source-token",
      userId: "target-person",
      groupId: null,
      creatorUserId: "target-person",
      ancestorIds: [],
      visibility: "private" as const,
      linkRole: "viewer" as const,
      access: "readwrite" as const,
      datasetPolicy: null,
      sharingRevision: 0,
      policyRevision: 0,
      editId: "source-edit",
      createdAt: time,
      updatedAt: time,
      deletedAt: null,
      shares: [],
    },
  };
  const projection = {
    imports: [],
    identities: {
      users,
      tokens: { "source-token": "source-token" },
      groups: {},
      artifacts: { [head.id]: head.id },
    },
    sourceNamespace: "synthetic",
    selectionSha256: "a".repeat(64),
    sourceManifestSha256: "b".repeat(64),
    objectManifestSha256: "c".repeat(64),
    identityPlanSha256: plan,
    typedUserRemaps: [derived.receipt],
    datasets: [dataset],
    objects: [
      {
        objectKey: key,
        targetKey: key,
        status: "copied" as const,
        sha256: nativeCatalogBytes(bytes),
        bytes: bytes.length,
      },
    ],
    sha256: "",
  };
  const sign = () => {
    const { sha256: _, ...body } = projection;
    projection.sha256 = nativeCatalogDigest(body);
  };
  sign();
  const source = {
    objectManifestSha256: projection.objectManifestSha256,
    read: async () => bytes,
    dataset: async () => raw,
    relations: async () => relations,
  };
  const objects = new Map<string, Buffer>();
  let writes = 0;
  const sink = {
    async get(key: string) {
      const b = objects.get(key);
      if (!b) throw Error("missing test object");
      return b;
    },
    async putIfAbsent(
      key: string,
      value: Buffer,
    ): Promise<"created" | "exists"> {
      writes++;
      if (objects.has(key)) return "exists";
      objects.set(key, Buffer.from(value));
      return "created";
    },
  };
  return {
    projection,
    source,
    sink,
    objects,
    bytes,
    key,
    derived,
    sign,
    stageNativeCatalog,
    get writes() {
      return writes;
    },
  };
}
it("stages canonical originals and proven derivatives and the real SQL reader filters by target actor without changing ordinary strings", async () => {
  const f = await stagedFixture(),
    staged = await f.stageNativeCatalog(f.projection, f.source, f.sink);
  expect(await f.sink.get(f.key)).toEqual(f.bytes);
  expect(await f.sink.get(f.derived.receipt.targetKey)).toEqual(
    f.derived.bytes,
  );
  await staged.verifyObject(
    f.derived.receipt.targetKey,
    f.derived.receipt.targetSha256,
    f.derived.receipt.targetBytes,
  );
  const { createSqliteSql } = await import("@artifactbin/sql/sqlite"),
    { executeCatalog } = await import("@/lib/datasets/execute"),
    sql = createSqliteSql();
  const result = await executeCatalog(
    f.projection.datasets[0]!.versions[0]!.meta.catalog as Parameters<
      typeof executeCatalog
    >[0],
    "SELECT owner,text FROM public.rows WHERE owner=$viewer",
    { viewer: "target-person" },
    { objects: f.sink, execute: (input) => sql.run(input) },
  );
  expect(result.rows).toEqual([
    { owner: "target-person", text: "source-person" },
  ]);
  expect(
    await f.stageNativeCatalog(f.projection, f.source, f.sink),
  ).toBeDefined();
});
it("rejects omitted, forged or wrongly typed remap receipts before any destination write", async () => {
  for (const kind of ["missing", "target", "column", "rehash"]) {
    const f = await stagedFixture();
    if (kind === "missing") {
      f.projection.typedUserRemaps = [];
      const meta = f.projection.datasets[0]!.versions[0]!.meta as {
        catalog: { tables: { objectKey: string }[] };
        objectKey: string;
      };
      meta.catalog.tables[0]!.objectKey = f.key;
      meta.objectKey = f.key;
    }
    if (kind === "target")
      f.projection.typedUserRemaps[0]!.targetSha256 = "0".repeat(64);
    if (kind === "column")
      f.projection.typedUserRemaps[0]!.userColumns = ["text"];
    if (kind === "rehash") {
      const r = f.projection.typedUserRemaps[0]!;
      r.targetBytes++;
      const { receiptSha256: _, ...body } = r;
      r.receiptSha256 = nativeCatalogDigest(body);
    }
    f.sign();
    await expect(
      f.stageNativeCatalog(f.projection, f.source, f.sink),
    ).rejects.toThrow();
    expect(f.writes).toBe(0);
  }
});
