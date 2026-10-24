import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { selectNativeRevisions } from "./selection.ts";
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function fixture() {
  const document = {
    kind: "graph",
    schema: 3,
    nodes: {
      $root: { parts: ["<p>kept</p>"], children: [], parent: null, ast: null },
    },
    claimedIds: { removed: 2 },
  };
  const head = { id: "synthetic-page", version: 7, document };
  const archive = { artifact_id: "synthetic-page", version: 2, document };
  const data = bytes({ snapshot: [], heads: [head], versions: [archive] });
  const receipt = {
    id: head.id,
    path: "page.json",
    bytes: data.length,
    sha256: hash(data),
    expectedVersion: 7,
    distinctRevisions: 2,
    archivedRows: 1,
  };
  return {
    data,
    receipt,
    request: {
      sourceNamespace: "synthetic",
      sourceIds: [head.id],
      expectedHeads: 1,
      expectedRevisions: 2,
      manifestBytes: bytes({
        createdAt: "2026-01-01",
        receipts: [receipt],
        failures: [],
      }),
      readFile: async () => data,
    },
  };
}
test("selects exact gap labels without rewriting originals and exposes source digests", async () => {
  const f = fixture();
  const index = await selectNativeRevisions(f.request);
  assert.equal(index.headCount, 1);
  assert.equal(index.revisionCount, 2);
  assert.deepEqual(
    index.pages[0]?.revisions.map((r) => r.key.version),
    [2, 7],
  );
  assert.equal(index.pages[0]?.headVersion, 7);
  assert.equal(
    index.pages[0]?.revisions[0]?.original.artifact_id,
    "synthetic-page",
  );
  assert.match(index.pages[0]!.revisions[0]!.documentSha256, /^[a-f0-9]{64}$/);
});
test("rejects byte/hash mismatch, missing/duplicate selection and wrong expected closure", async () => {
  const f = fixture();
  await assert.rejects(
    selectNativeRevisions({
      ...f.request,
      readFile: async () => Buffer.from("bad"),
    }),
    /canonical_file/,
  );
  await assert.rejects(
    selectNativeRevisions({ ...f.request, sourceIds: ["absent"] }),
    /selection/,
  );
  await assert.rejects(
    selectNativeRevisions({
      ...f.request,
      sourceIds: ["synthetic-page", "synthetic-page"],
      expectedHeads: 2,
    }),
    /selection/,
  );
  await assert.rejects(
    selectNativeRevisions({ ...f.request, expectedRevisions: 3 }),
    /revision_count/,
  );
});
test("retains equal redundant archives and blocks divergent same-version records or foreign rows", async () => {
  const f = fixture();
  const page = JSON.parse(f.data.toString());
  page.versions.push({ ...page.heads[0], artifact_id: "synthetic-page" });
  const run = () => {
    const data = bytes(page);
    return selectNativeRevisions({
      ...f.request,
      manifestBytes: bytes({
        receipts: [
          {
            ...f.receipt,
            bytes: data.length,
            sha256: hash(data),
            archivedRows: 2,
          },
        ],
        failures: [],
      }),
      readFile: async () => data,
    });
  };
  assert.equal(
    (await run()).pages[0]?.revisions[1]?.matchingArchives.length,
    1,
  );
  page.versions[1].document = { different: true };
  await assert.rejects(run(), /revision_conflict/);
  page.versions[1].artifact_id = "foreign";
  await assert.rejects(run(), /row_identity/);
});
