import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeCatalogInventory } from "../src/migration/native-components/catalog-inventory.ts";
import { encodeNativePublicationBytes, decodeNativePublicationBytes } from "../src/migration/native-components/pipeline-publication.ts";
import { nativeDigest } from "../src/migration/native-components/selection.ts";
import type { NativeCatalogInventoryInput } from "../src/migration/native-components/catalog-inventory-contracts.ts";
const pin = "a".repeat(64),
  encode = (v: unknown) =>
    encodeNativePublicationBytes(Buffer.from(JSON.stringify(v)));
function fixture(): NativeCatalogInventoryInput {
  const targets = {
    actors: {},
    users: { user: { userId: "mapped-user", email: null } },
    tokens: { token: { tokenId: "mapped-token" } },
  };
  const identityPlan = {
    sourceNamespace: "synthetic",
    sha256: pin,
    targets,
    artifactIds: { DataAA: "DataAA", DataBB: "DataBB", ScopeA: "ScopeA" },
  };
  const captures = ["DataAA", "DataBB"].map((sourceId, index) => {
    const version = index + 2,
      meta = {
        objectKey: "object-" + sourceId,
        catalog: {
          kind: "stored",
          tables: [
            {
              schema: "public",
              name: "rows",
              objectKey: "object-" + sourceId,
              columns: [
                {
                  name: "owner",
                  type: "user",
                  constraints: { memberOf: ["current", "ref:ScopeA"] },
                },
              ],
            },
          ],
        },
      };
    const head = {
      id: sourceId,
      format: "dataset",
      version,
      meta,
      source: null,
      title: sourceId,
      description: null,
      user_id: "user",
      token_id: "token",
      group_id: null,
      creator_user_id: "user",
      ancestor_ids: [],
      visibility: "private",
      link_role: "viewer",
      access: "readwrite",
      dataset_policy: { version: 2, allow: [{ from: { user: "user" } }] },
      policy_revision: 2,
      sharing_revision: 1,
      edit_id: "edit",
      actor_user_id: "user",
      actor_token_id: "token",
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-02-01T00:00:00.000Z",
      deleted_at: null,
    };
    return {
      sourceId,
      version,
      headSha256: nativeDigest(head),
      source: {
        path: sourceId + ".json",
        bytes: encode({ heads: [head], versions: [{ ...head, version: 1 }] }),
      },
      relations: {
        path: sourceId + "-relations.json",
        bytes: encode({
          heads: [{ id: sourceId, version, updated_at: head.updated_at }],
          artifact_shares: [
            {
              artifact_id: sourceId,
              email: "viewer@example.test",
              role: "viewer",
            },
          ],
          dataset_policy_audit: [
            {
              dataset_id: sourceId,
              revision: 1,
              policy: null,
              actor_user_id: "user",
              actor_token_id: "token",
              created_at: head.created_at,
            },
            {
              dataset_id: sourceId,
              revision: 2,
              policy: head.dataset_policy,
              actor_user_id: "user",
              actor_token_id: "token",
              created_at: head.updated_at,
            },
          ],
        }),
      },
      catalogSha256: nativeDigest(meta.catalog),
      policySha256: nativeDigest({
        datasetPolicy: head.dataset_policy,
        policyRevision: 2,
        sharingRevision: 1,
        visibility: "private",
        owner: "user",
      }),
    };
  });
  return {
    sourceNamespace: "synthetic",
    selectionSha256: pin,
    sourceManifestSha256: pin,
    identityPlan,
    captures,
    objectLedger: encode(
      captures.map((c) => ({
        objectKey: "object-" + c.sourceId,
        status: "copied",
        sha256: pin,
        bytes: 10,
        path: "objects/" + c.sourceId,
      })),
    ),
    typedUserRemaps: [],
    metadata: [],
    externalConnections: [],
    root: "capture",
    ledgerPath: "objects.json",
    sinkDirectory: "staged",
  };
}
test("shared inventory derives only exact current dataset versions and maps policy identities", () => {
  const result = buildNativeCatalogInventory(fixture());
  assert.equal(result.projection.datasets.length, 2);
  for (const dataset of result.projection.datasets) {
    assert.deepEqual(dataset.expectedVersions, [dataset.currentVersion]);
    assert.equal(dataset.versions.length, 1);
    const authority = dataset.authority as any;
    assert.equal(authority.userId, "mapped-user");
    assert.equal(authority.tokenId, "mapped-token");
    assert.equal(authority.datasetPolicy.allow[0].from.user, "mapped-user");
    assert.equal((dataset.policyAudit as any[]).length, 1);
  }
  assert.equal(result.projection.objects.length, 2);
  assert.deepEqual(result.projection.imports, []);
});
test("rejects stale heads, altered receipts, unmapped owners and absent immutable objects", () => {
  const i = fixture();
  assert.throws(
    () =>
      buildNativeCatalogInventory({
        ...i,
        captures: [{ ...i.captures[0]!, version: 1 }],
      }),
    /head/,
  );
  assert.throws(
    () =>
      buildNativeCatalogInventory({
        ...i,
        captures: [{ ...i.captures[0]!, headSha256: pin }],
      }),
    /head/,
  );
  assert.throws(
    () =>
      buildNativeCatalogInventory({
        ...i,
        identityPlan: {
          ...i.identityPlan,
          targets: { ...i.identityPlan.targets, users: {} },
        },
      }),
    /identity/,
  );
  assert.throws(
    () => buildNativeCatalogInventory({ ...i, objectLedger: encode([]) }),
    /object/,
  );
});

test("metadata remap remains source-bound while immutable source object receipts survive", () => {
  const i = fixture(),
    capture = i.captures[0]!,
    raw = JSON.parse(
      Buffer.from(capture.source.bytes.data, "base64").toString(),
    ),
    head = raw.heads[0],
    meta = structuredClone(head.meta);
  meta.objectKey = "derived-object";
  meta.catalog.tables[0].objectKey = "derived-object";
  i.metadata = [
    {
      sourceId: capture.sourceId,
      version: capture.version,
      sourceRowSha256: capture.headSha256,
      sourceMetaSha256: nativeDigest(head.meta),
      targetMetaSha256: nativeDigest(meta),
      meta,
    },
  ];
  i.typedUserRemaps = [
    {
      sourceId: capture.sourceId,
      version: capture.version,
      identityPlanSha256: pin,
      sourceObjectKey: "object-" + capture.sourceId,
      targetKey: "derived-object",
    },
  ];
  const result = buildNativeCatalogInventory(i);
  assert.equal(
    result.projection.datasets[0]!.versions[0]!.meta.objectKey,
    "derived-object",
  );
  assert.equal(
    result.projection.objects.some(
      (o) => o.objectKey === "object-" + capture.sourceId,
    ),
    true,
  );
  assert.throws(
    () =>
      buildNativeCatalogInventory({
        ...i,
        metadata: [{ ...i.metadata[0]!, sourceMetaSha256: pin }],
      }),
    /metadata_changed/,
  );
});

import { prepareNativePublication } from "../src/migration/native-components/pipeline-publication.ts";
import { bindNativeIdentities } from "../src/migration/native-components/identity.ts";
import { assembleNativePage } from "../src/migration/native-components/assemble.ts";
import { nativeReceiptDigest } from "../src/migration/native-components/receipt-digest.ts";
import { NATIVE_COMPONENT_TARGET } from "../src/migration/native-components/component-map.ts";
import type { NativeGraphAnalysis } from "../src/migration/native-components/contracts.ts";
import type { NativeTypedAnalysis } from "../src/migration/native-components/analyze-contracts.ts";
import type {
  NativePublicationInput,
  NativePublicationHost,
} from "../src/migration/native-components/pipeline-publication-contracts.ts";
function publication(
  inventory: ReturnType<typeof buildNativeCatalogInventory>,
  shared: NativeCatalogInventoryInput,
  sourceId: string,
  datasetId: string,
): { input: NativePublicationInput; host: NativePublicationHost } {
  const key = { sourceNamespace: "synthetic", sourceId, version: 4 },
    row = {
      id: sourceId,
      version: 4,
      format: "markup",
      user_id: "user",
      token_id: "token",
      group_id: null,
      source: "Text",
      document: { sourceId },
      title: "Example",
      description: null,
      meta: {},
      created_at: "2020-03-01T00:00:00.000Z",
      actor_user_id: "user",
      actor_token_id: "token",
      visibility: "private",
      link_role: "viewer",
    };
  const graph: NativeGraphAnalysis = {
    key,
    source: "Text",
    sourceSha256: pin,
    documentSha256: nativeDigest(row.document),
    identities: [
      {
        sourceNode: "$root",
        parent: null,
        children: ["text"],
        sourceStart: 0,
        sourceEnd: 4,
        astSha256: pin,
        nodeSha256: pin,
      },
      {
        sourceNode: "text",
        parent: "$root",
        children: [],
        sourceStart: 0,
        sourceEnd: 4,
        astSha256: pin,
        nodeSha256: pin,
      },
    ],
    claimedIds: {},
    components: {},
    recovery: { kind: "exact", repairedNodes: 0 },
  };
  const analysis: NativeTypedAnalysis = {
    key,
    documentSha256: graph.documentSha256,
    sourceSha256: pin,
    analysisSha256: nativeDigest(graph),
    compilerSourceSha256: pin,
    nodes: [
      { type: "text", graphKey: "text", value: "Text", start: 0, end: 4 },
    ],
    flow: {
      imports: [{ name: "data", ref: datasetId, start: 0, end: 4 }],
      values: [],
      queries: [{ name: "rows", start: 0, end: 4 }],
      mutations: [],
    },
    sourceSpans: graph.identities.map((n) => ({
      sourceNode: n.sourceNode,
      sourceStart: n.sourceStart,
      sourceEnd: n.sourceEnd,
    })),
  };
  const identity = bindNativeIdentities([{ graph, typed: analysis }])[0]!,
    query = {
      name: "rows",
      namespace: "queries",
      document:
        "query Rows($only:[queries__QueryName!]!){queries{evaluate(only:$only){tables{name error}}}}",
      values: [],
      tableName: "rows",
      responsePath: ["queries", "evaluate", "tables"],
      decode: "registered-page-table-cells-v1" as const,
    },
    operations = [
      { kind: "query" as const, name: "rows", operationSha256: pin },
    ],
    program = {
      scalars: {},
      queries: [
        { name: "rows", sql: "SELECT * FROM data.rows", dependencies: [] },
      ],
      imports: [{ alias: "data", binding: datasetId, table: "rows" }],
    };
  const assemblyInput = {
    analysis,
    identity,
    targetRevision: NATIVE_COMPONENT_TARGET,
    coreUrl: "/af/v1/core.js",
    queries: [query],
    mutations: [],
    backends: [
      {
        namespace: "queries",
        url: "https://example.invalid/api/artifacts/" + sourceId + "/graphql",
        descriptorsSha256: nativeDigest({ queries: [query], mutations: [] }),
        planSha256: pin,
        operations,
      },
    ],
    operationCoverage: {
      sourceSha256: pin,
      compilerSourceSha256: pin,
      sqlEngineSha256: pin,
      queryOrder: ["rows"],
      blockers: [],
      operations: [
        {
          ...operations[0]!,
          sourceNode: "$flow",
          route: "registered-sqlite-query" as const,
          dependencies: [],
          requiredGuarantees: [],
          status: "attested-plan" as const,
        },
      ],
    },
  };
  const result = assembleNativePage(assemblyInput);
  assert.equal(result.status, "complete", JSON.stringify(result.blockers));
  const receipt = {
    key,
    sourceRowSha256: nativeDigest(row),
    input: assemblyInput,
    result,
    programs: [
      {
        kind: "query" as const,
        namespace: "queries",
        backendId: "backend_" + sourceId,
        planSha256: pin,
        programSha256: nativeDigest(program),
        program,
        provenance: {
          sourceSha256: pin,
          compilerSha256: pin,
          sqlEngineSha256: pin,
        },
        operations,
      },
    ],
  };
  const targets = shared.identityPlan.targets,
    maps = {
      pages: { ...shared.identityPlan.artifactIds },
      users: { user: "owner@example.test" },
      tokens: { token: "owner@example.test" },
      groups: {},
    };
  const input: NativePublicationInput = {
    selection: {
      sourceNamespace: "synthetic",
      manifestSha256: pin,
      page: {
        sourceId,
        headVersion: 4,
        sourceFile: {
          id: sourceId,
          path: "head.json",
          sha256: pin,
          bytes: 10,
          expectedVersion: 4,
          distinctRevisions: 1,
          archivedRows: 0,
        },
        revisions: [
          {
            key,
            rowSha256: nativeDigest(row),
            documentSha256: nativeDigest(row.document),
            original: row,
            matchingArchives: [],
          },
        ],
      },
    },
    assemblies: [{ ...receipt, sha256: nativeReceiptDigest(receipt) }],
    relations: encode({ annotations: [] }),
    shared: {
      maps,
      targets,
      tokenOwners: [{ id: "token", user_id: "user" }],
      identity: {
        plan: shared.identityPlan,
        approvedPlanSha256: pin,
        sourceInventory: {},
        targetInventory: {},
        revokedAt: "2026-01-01T00:00:00.000Z",
      },
      schemas: { appSchema: "app", authSchema: "auth" },
      catalog: inventory,
      membership: {
        source: { capture: encode({}) },
        approved: { captureSha256: pin },
      },
    },
    exportedAt: "2026-01-01T00:00:00.000Z",
    coreUrl: "/af/v1/core.js",
  };
  const host: NativePublicationHost = {
    async prepare() {
      return {
        canonicalize(html, options) {
          return {
            html,
            ledger: options.ledger,
            nodeIds: [...html.matchAll(/data-af-id="([^"]+)"/g)].map(
              (m) => m[1]!,
            ),
          };
        },
        commentNodeIds: () => [],
        prepareQuery(page, r) {
          return {
            link: {
              kind: "backend",
              name: r.namespace,
              backendId: r.backendId,
              version: pin,
            },
            backend: {
              name: r.namespace,
              source: page.html,
              compiled: "fixture",
              typeDefs: "type Query {value:Int}",
            },
            envelope: {},
          };
        },
        prepareMutation() {
          throw Error("unused");
        },
        verifyProgram() {},
      };
    },
  };
  return { input, host };
}
test("two unrelated latest heads consume one inventory with isolated dataset and original-remap object closures", async () => {
  const i = fixture();
  i.identityPlan.targets.actors = {
    "owner@example.test": { userId: "mapped-user" },
  };
  i.identityPlan.artifactIds = {
    ...i.identityPlan.artifactIds,
    PageAA: "PageAA",
    PageBB: "PageBB",
  };
  const capture = i.captures[0]!,
    raw = JSON.parse(
      Buffer.from(capture.source.bytes.data, "base64").toString(),
    ),
    meta = structuredClone(raw.heads[0].meta);
  meta.objectKey = "derived-object";
  meta.catalog.tables[0].objectKey = "derived-object";
  i.metadata = [
    {
      sourceId: capture.sourceId,
      version: capture.version,
      sourceRowSha256: capture.headSha256,
      sourceMetaSha256: nativeDigest(raw.heads[0].meta),
      targetMetaSha256: nativeDigest(meta),
      meta,
    },
  ];
  i.typedUserRemaps = [
    {
      sourceId: capture.sourceId,
      version: capture.version,
      identityPlanSha256: pin,
      sourceObjectKey: "object-" + capture.sourceId,
      targetKey: "derived-object",
    },
  ];
  const inventory = buildNativeCatalogInventory(i),
    a = publication(inventory, i, "PageAA", "DataAA"),
    b = publication(inventory, i, "PageBB", "DataBB");
  const [first, second] = await Promise.all([
    prepareNativePublication(a.input, a.host),
    prepareNativePublication(b.input, b.host),
  ]);
  assert.deepEqual(
    first.recipe.catalog.projection.datasets.map((d) => d.sourceId),
    ["DataAA"],
  );
  assert.deepEqual(
    second.recipe.catalog.projection.datasets.map((d) => d.sourceId),
    ["DataBB"],
  );
  assert.deepEqual(
    first.recipe.catalog.projection.objects.map((o) => o.objectKey),
    ["object-DataAA"],
  );
  assert.equal(
    first.recipe.catalog.projection.datasets[0]?.versions[0]?.meta.objectKey,
    "derived-object",
  );
  assert.deepEqual(
    second.recipe.catalog.projection.objects.map((o) => o.objectKey),
    ["object-DataBB"],
  );
  assert.equal(first.recipe.catalog.projection.imports[0]?.pageId, "PageAA");
  assert.equal(second.recipe.catalog.projection.imports[0]?.pageId, "PageBB");
  assert.deepEqual(
    first.recipe.history.revisions.map((r) => r.page.version),
    [4],
  );
  assert.equal(inventory.projection.datasets.length, 2);
});

test("external catalogs require exact credential provenance digests without emitting credentials", () => {
  const i = fixture(),
    capture = i.captures[0]!,
    source = JSON.parse(
      Buffer.from(capture.source.bytes.data, "base64").toString(),
    ),
    head = source.heads[0];
  head.meta.catalog.kind = "postgres";
  delete head.meta.objectKey;
  delete head.meta.catalog.tables[0].objectKey;
  head.dataset_policy = null;
  const selected = {
    ...capture,
    headSha256: nativeDigest(head),
    source: {
      ...capture.source,
      bytes: encode({ heads: [head], versions: source.versions }),
    },
    catalogSha256: nativeDigest(head.meta.catalog),
    policySha256: nativeDigest({
      datasetPolicy: head.dataset_policy,
      policyRevision: head.policy_revision,
      sharingRevision: head.sharing_revision,
      visibility: head.visibility,
      owner: head.user_id,
    }),
  };
  const external = {
    ...i,
    captures: [selected],
    externalConnections: [
      { datasetSourceId: selected.sourceId, sourceSecretSha256: pin },
    ],
  };
  assert.throws(
    () => buildNativeCatalogInventory({ ...external, externalConnections: [] }),
    /external_receipt_missing/,
  );
  const output = buildNativeCatalogInventory(external);
  assert.deepEqual(
    output.projection.externalConnections,
    external.externalConnections,
  );
  assert.deepEqual(output.projection.objects, []);
  assert.equal(output.projection.datasets[0]?.versions.length, 1);
});

test("current policy audit projects only the empty token sentinel to null without rewriting source evidence", () => {
  const input = fixture();
  const capture = input.captures[0]!;
  const relations = JSON.parse(Buffer.from(decodeNativePublicationBytes(capture.relations.bytes)).toString());
  relations.dataset_policy_audit[1].actor_token_id = "";
  capture.relations.bytes = encode(relations);
  const before = structuredClone(input);
  const result = buildNativeCatalogInventory(input);
  const audit = result.projection.datasets[0]!.policyAudit as any[];
  assert.equal(audit[0].actorTokenId, null);
  assert.equal(audit[0].actorUserId, "mapped-user");
  assert.equal((result.projection.datasets[0]!.authority as any).tokenId, "mapped-token");
  assert.deepEqual(input, before);
  assert.equal(JSON.parse(Buffer.from(decodeNativePublicationBytes(capture.relations.bytes)).toString()).dataset_policy_audit[1].actor_token_id, "");
  relations.dataset_policy_audit[1].actor_token_id = "nonempty-unmapped-token";
  capture.relations.bytes = encode(relations);
  assert.throws(() => buildNativeCatalogInventory(input), /identity_unmapped/);
  relations.dataset_policy_audit[1].actor_token_id = "";
  relations.dataset_policy_audit[1].actor_user_id = "";
  capture.relations.bytes = encode(relations);
  assert.throws(() => buildNativeCatalogInventory(input), /identity_unmapped/);
});
