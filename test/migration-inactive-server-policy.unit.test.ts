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
