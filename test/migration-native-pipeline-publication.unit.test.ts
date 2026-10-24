import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareNativePublication,
  encodeNativePublicationBytes,
  decodeNativePublicationBytes,
} from "../src/migration/native-components/pipeline-publication.ts";
import { nativeDigest } from "../src/migration/native-components/selection.ts";
import { nativeReceiptDigest } from "../src/migration/native-components/receipt-digest.ts";
import { bindNativeIdentities } from "../src/migration/native-components/identity.ts";
import { assembleNativePage } from "../src/migration/native-components/assemble.ts";
import { NATIVE_COMPONENT_TARGET } from "../src/migration/native-components/component-map.ts";
import type { NativeGraphAnalysis } from "../src/migration/native-components/contracts.ts";
import type { NativeTypedAnalysis } from "../src/migration/native-components/analyze-contracts.ts";
import type {
  NativePublicationInput,
  NativePublicationHost,
} from "../src/migration/native-components/pipeline-publication-contracts.ts";
const pin = "a".repeat(64),
  encode = (value: unknown) =>
    encodeNativePublicationBytes(Buffer.from(JSON.stringify(value)));
function fixture(
  sourceId = "SourceA",
  targetId = "TargAA",
): { input: NativePublicationInput; host: NativePublicationHost } {
  const row = {
    id: sourceId,
    version: 3,
    format: "markup",
    user_id: "old-user",
    token_id: "old-token",
    group_id: null,
    source: "Retained",
    document: { kind: "graph", sourceId },
    title: "Example",
    description: null,
    meta: {},
    created_at: "2020-01-03T00:00:00.000Z",
    actor_user_id: "old-user",
    actor_token_id: "old-token",
    visibility: "private",
    link_role: "viewer",
  };
  const old = { ...row, version: 1, document: { kind: "old-graph", sourceId } };
  const key = { sourceNamespace: "synthetic", sourceId, version: 3 };
  const graph: NativeGraphAnalysis = {
    key,
    source: "Retained",
    sourceSha256: pin,
    documentSha256: nativeDigest(row.document),
    identities: [
      {
        sourceNode: "$root",
        parent: null,
        children: ["text"],
        sourceStart: 0,
        sourceEnd: 8,
        astSha256: pin,
        nodeSha256: pin,
      },
      {
        sourceNode: "text",
        parent: "$root",
        children: [],
        sourceStart: 0,
        sourceEnd: 8,
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
    sourceSha256: pin,
    documentSha256: graph.documentSha256,
    analysisSha256: nativeDigest(graph),
    compilerSourceSha256: pin,
    nodes: [
      { type: "text", graphKey: "text", value: "Retained", start: 0, end: 8 },
    ],
    flow: { values: [], queries: [], mutations: [], imports: [] },
    sourceSpans: graph.identities.map((n) => ({
      sourceNode: n.sourceNode,
      sourceStart: n.sourceStart,
      sourceEnd: n.sourceEnd,
    })),
  };
  const identity = bindNativeIdentities([{ graph, typed: analysis }])[0]!;
  const assemblyInput = {
    analysis,
    identity,
    targetRevision: NATIVE_COMPONENT_TARGET,
    coreUrl: "/af/v1/core.js",
    backends: [],
    queries: [],
    mutations: [],
  };
  const result = assembleNativePage(assemblyInput);
  assert.equal(result.status, "complete");
  const receipt = {
    key,
    sourceRowSha256: nativeDigest(row),
    input: assemblyInput,
    result,
    programs: [],
  };
  const targets = {
    actors: { "owner@example.test": { userId: "target-user" } },
    users: {
      "old-user": { userId: "target-user", email: "owner@example.test" },
    },
    tokens: { "old-token": { tokenId: "target-token" } },
  };
  const maps = {
    pages: { [sourceId]: targetId },
    users: { "old-user": "owner@example.test" },
    tokens: { "old-token": "owner@example.test" },
    groups: {},
  };
  const identityPlan = {
    sourceNamespace: "synthetic",
    sha256: pin,
    targets,
    artifactIds: maps.pages,
  };
  const catalogBody = {
    revisionScope: "latest" as const,
    sourceNamespace: "synthetic",
    selectionSha256: pin,
    identityPlanSha256: pin,
    sourceManifestSha256: pin,
    objectManifestSha256: pin,
    identities: {
      users: { "old-user": "target-user" },
      tokens: { "old-token": "target-token" },
      groups: {},
      artifacts: maps.pages,
    },
    datasets: [],
    objects: [],
    imports: [],
  };
  const input: NativePublicationInput = {
    selection: {
      sourceNamespace: "synthetic",
      manifestSha256: pin,
      page: {
        sourceId,
        headVersion: 3,
        sourceFile: {
          id: sourceId,
          path: "captured.json",
          sha256: pin,
          bytes: 100,
          expectedVersion: 3,
          distinctRevisions: 2,
          archivedRows: 1,
        },
        revisions: [old, row].map((original) => ({
          key: { ...key, version: original.version },
          rowSha256: nativeDigest(original),
          documentSha256: nativeDigest(original.document),
          original,
          matchingArchives: [],
        })),
      },
    },
    assemblies: [{ ...receipt, sha256: nativeReceiptDigest(receipt) }],
    relations: encode({
      annotations: [],
      artifact_versions: [old],
      artifacts: [row],
    }),
    shared: {
      maps,
      targets,
      tokenOwners: [{ id: "old-token", user_id: "old-user" }],
      identity: {
        plan: identityPlan,
        approvedPlanSha256: pin,
        sourceInventory: {},
        targetInventory: {},
        revokedAt: "2026-01-01T00:00:00.000Z",
      },
      schemas: { appSchema: "app", authSchema: "auth" },
      catalog: {
        projection: { ...catalogBody, sha256: nativeDigest(catalogBody) },
        root: "capture",
        ledgerPath: "objects.json",
        receipts: {},
        sinkDirectory: "staged",
      },
      membership: {
        source: { capture: encode({ relations: [] }) },
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
        commentNodeIds: (html) =>
          [...html.matchAll(/data-af-id="([^"]+)"/g)].map((m) => m[1]!),
        prepareQuery() {
          throw Error("unused");
        },
        prepareMutation() {
          throw Error("unused");
        },
        verifyProgram() {
          throw Error("unused");
        },
      };
    },
  };
  return { input, host };
}
test("two selected source IDs produce isolated latest-only recipes without archived conversion", async () => {
  const a = fixture(),
    b = fixture("SourceB", "TargBB");
  const [first, second] = await Promise.all([
    prepareNativePublication(a.input, a.host),
    prepareNativePublication(b.input, b.host),
  ]);
  assert.equal(first.recipe.history.sourceId, "SourceA");
  assert.equal(second.recipe.history.sourceId, "SourceB");
  assert.equal(first.recipe.history.pageId, "TargAA");
  assert.equal(second.recipe.history.pageId, "TargBB");
  assert.deepEqual(
    first.recipe.history.revisions.map((r) => r.page.version),
    [3],
  );
  assert.deepEqual(
    first.planned.revisions.map((r) => r.version),
    [3],
  );
  assert.equal(first.recipe.revisionScope, "latest");
  assert.equal(first.recipe.catalog.projection.datasets.length, 0);
  assert.equal(
    first.recipe.history.revisions[0]?.page.html.includes("Retained"),
    true,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(first.recipe)), first.recipe);
});
test("rejects changed raw evidence, another selected assembly and historical assemblies", async () => {
  const { input, host } = fixture();
  const other = fixture("SourceB", "TargBB");
  await assert.rejects(
    prepareNativePublication(
      { ...input, assemblies: other.input.assemblies },
      host,
    ),
    /selected_head_required/,
  );
  await assert.rejects(
    prepareNativePublication(
      { ...input, assemblies: [...input.assemblies, ...input.assemblies] },
      host,
    ),
    /selected_head_required/,
  );
  assert.throws(
    () =>
      decodeNativePublicationBytes({
        ...input.relations,
        data: Buffer.from("{}").toString("base64"),
      }),
    /capture_changed/,
  );
});
test("comments preserve original old-version root context and exclude other pages", async () => {
  const { input, host } = fixture();
  const root = {
    id: "root",
    artifact_id: "SourceA",
    revision: 1,
    root_id: null,
    seq: "1",
    body: "old context",
    author_kind: "human",
    author_user_id: "old-user",
    author_token_id: "old-token",
    author_label: null,
    author_transport: "browser",
    status: "open",
    resolved_at: null,
    created_at: "2020-01-01T00:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    change_seq: 1,
    author_remote: null,
    snippet: "context",
    quote: "quote",
    range: null,
    view_state: null,
    anchor_key: "old-node",
    anchor_version: 1,
  };
  const reply = {
    ...root,
    id: "reply",
    root_id: "root",
    seq: "2",
    body: "reply",
    anchor_version: 3,
  };
  input.relations = encode({
    annotations: [
      reply,
      { ...root, id: "other", artifact_id: "SourceB" },
      root,
    ],
  });
  const result = await prepareNativePublication(input, host);
  assert.deepEqual(
    result.recipe.relations.annotations.map((a) => a.id),
    ["root", "reply"],
  );
  for (const comment of result.recipe.relations.annotations) {
    assert.equal(comment.anchor, null);
    assert.equal(comment.authorUserId, "target-user");
    const context = comment.retainedContext as any;
    assert.equal(context.originalRevision, 1);
    assert.equal(context.sourceVersionRetained, true);
    assert.equal(context.targetVersionMigrated, false);
    assert.equal(context.originalAnchorKey, "old-node");
  }
});

test("shared catalog filters unrelated dataset and object evidence from a selected recipe", async () => {
  const { input, host } = fixture();
  const { sha256, ...body } = input.shared.catalog.projection;
  void sha256;
  const changed = {
    ...body,
    datasets: [
      {
        sourceId: "Unrelated",
        targetId: "OtherD",
        currentVersion: 9,
        expectedVersions: [9],
        versions: [{ version: 9, meta: { objectKey: "unrelated-object" } }],
      },
    ],
    objects: [{ objectKey: "unrelated-object", sha256: pin }],
    typedUserRemaps: [{ sourceId: "Unrelated" }],
    externalConnections: [{ datasetSourceId: "Unrelated" }],
  };
  input.shared.catalog.projection = {
    ...changed,
    sha256: nativeDigest(changed),
  };
  input.shared.catalog.receipts = {
    Unrelated: {
      path: "unrelated.json",
      sha256: pin,
      relations: { path: "unrelated-relations.json", sha256: pin },
    },
  };
  const output = await prepareNativePublication(input, host);
  assert.deepEqual(output.recipe.catalog.projection.datasets, []);
  assert.deepEqual(output.recipe.catalog.projection.objects, []);
  assert.deepEqual(output.recipe.catalog.projection.typedUserRemaps, []);
  assert.deepEqual(output.recipe.catalog.projection.externalConnections, []);
  assert.deepEqual(output.recipe.catalog.receipts, {});
});
