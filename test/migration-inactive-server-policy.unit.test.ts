import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareInactiveServerDocument } from "../src/migration/server-document.ts";
import { admitInactiveServerDocument } from "../src/migration/server-document-policy.ts";
import { prepareMigrationPageQueries } from "../src/migration/job-queries.ts";
import type { PlannedPage } from "../src/migration/contracts.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const source =
  '<Helmet><script type="server">{`export default async function(input){return input}`}</script></Helmet><p>Content</p>';
const view = prepareInactiveServerDocument(source, {
  mode: "archived-inactive",
});
const admission = {
  legacyId: "old-example",
  version: 1,
  mode: "archived-inactive" as const,
  originalSourceSha256: hash(source),
  handlerSourceSha256: view.handler.sourceSha256,
  renderSourceSha256: hash(view.renderSource),
};
function page() {
  const admitted = admitInactiveServerDocument(source, admission);
  return {
    legacyId: "old-example",
    pageId: "Page01",
    original: { format: "markup", version: 1, source },
    disposition: "ready",
    issues: [],
    revisions: [
      {
        version: 1,
        conversion: {
          classification: "functional",
          html: admitted.source,
          archivedInactiveServerDocument: admitted.receipt,
        },
      },
    ],
  } as unknown as PlannedPage;
}
test("undeclared handlers still require real saved query registration", async () => {
  const p = page();
  await prepareMigrationPageQueries([p], undefined);
  assert.equal(p.disposition, "blocked");
  assert(p.issues.includes("query_registration_unavailable"));
});
test("exact explicit inactive receipt preserves readiness without fabricating server authority", async () => {
  const p = page();
  await prepareMigrationPageQueries([p], undefined, undefined, undefined, [
    admission,
  ]);
  assert.equal(p.disposition, "ready");
  assert.equal(p.serverQueries, undefined);
  assert.equal(p.backends, undefined);
  assert.deepEqual(p.issues, []);
});
test("hash mismatches, absent conversion receipt or removed limitation cannot bypass registration", async () => {
  for (const key of [
    "originalSourceSha256",
    "handlerSourceSha256",
    "renderSourceSha256",
  ] as const)
    assert.throws(
      () =>
        admitInactiveServerDocument(source, {
          ...admission,
          [key]: "0".repeat(64),
        }),
      /mismatch/,
    );
  for (const alter of [
    (p: PlannedPage) =>
      delete p.revisions[0]!.conversion.archivedInactiveServerDocument,
    (p: PlannedPage) => {
      p.revisions[0]!.conversion.html = "<p>Content</p>";
    },
  ]) {
    const p = page();
    alter(p);
    await prepareMigrationPageQueries([p], undefined, undefined, undefined, [
      admission,
    ]);
    assert.equal(p.disposition, "blocked");
    assert.equal(p.serverQueries, undefined);
  }
  const mismatch = page();
  await prepareMigrationPageQueries(
    [mismatch],
    undefined,
    undefined,
    undefined,
    [{ ...admission, handlerSourceSha256: "0".repeat(64) }],
  );
  assert.equal(mismatch.disposition, "blocked");
});

test("exact inactive declaration removes sole handler candidate before backend allocation while preserving unrelated viewer capability", async () => {
  const { scanMigrationDatasetImports } = await import(
    "../src/migration/dataset-scan.ts"
  );
  const row = {
    id: "old-example",
    version: 1,
    format: "markup",
    source,
    user_id: "owner",
    group_id: null,
    token_id: null,
    visibility: "private",
    link_role: "viewer",
    edit_id: "edit",
  };
  const base = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    tables: { users: [{ id: "owner", kind: "user" }] },
    artifacts: [row],
    tokenOwners: [],
  };
  const input = {
    ids: ["old-example"],
    maps: {
      pages: { "old-example": "Page01" },
      users: { owner: "owner@example.test" },
      tokens: {},
      groups: {},
    },
    manifest: { sourceNamespace: "fixture" },
    base,
    readArtifact: async () => base,
  } as unknown as import("../src/migration/job-contracts.ts").MigrationJobSource;
  const active = await scanMigrationDatasetImports(input);
  assert.equal(active.pages[0]?.revisions[0]?.runsProgram, true);
  const inactive = await scanMigrationDatasetImports(
    input,
    undefined,
    [],
    undefined,
    "strict",
    [],
    [admission],
  );
  assert.deepEqual(inactive.pages, []);
  const viewerSource = source + "{$_me.id ? <p>Reader</p>:<p>Guest</p>}";
  const viewerView = prepareInactiveServerDocument(viewerSource, {
    mode: "archived-inactive",
  });
  const viewerAdmission = {
    ...admission,
    originalSourceSha256: hash(viewerSource),
    renderSourceSha256: hash(viewerView.renderSource),
  };
  row.source = viewerSource;
  const viewer = await scanMigrationDatasetImports(
    input,
    undefined,
    [],
    undefined,
    "strict",
    [],
    [viewerAdmission],
  );
  assert.equal(viewer.pages[0]?.revisions[0]?.runsProgram, undefined);
  assert.equal(viewer.pages[0]?.revisions[0]?.readsViewer, true);
  await assert.rejects(
    scanMigrationDatasetImports(
      input,
      undefined,
      [],
      undefined,
      "strict",
      [],
      [admission],
    ),
    /mismatch/,
  );
});
