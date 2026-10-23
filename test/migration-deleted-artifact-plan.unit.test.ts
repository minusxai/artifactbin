import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PlannedPage } from "../src/migration/contracts.ts";
import type { DeletedArtifactPlanningInput } from "../src/migration/deleted-artifact-contracts.ts";
import { canonicalMigrationValue } from "../src/migration/verification-values.ts";
import { prepareDeletedArtifactPlan } from "../src/migration/deleted-artifact-plan.ts";
import { preserveUnavailableHistoricalRevision } from "../src/migration/historical-unavailable.ts";
const sha = (v: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(v)).digest("hex");
function fixture(): DeletedArtifactPlanningInput {
  const original = {
    id: "legacy-deleted",
    format: "html",
    version: 2,
    user_id: "owner",
    group_id: null,
    token_id: null,
    source: "<h1>Head</h1>",
    document: null,
    visibility: "private",
    link_role: null,
    deleted_at: "2024-01-02T03:04:05.000Z",
  };
  const page: PlannedPage = {
    legacyId: original.id,
    pageId: "destination-deleted",
    owner: { kind: "user", id: "owner" },
    disposition: "blocked",
    issues: ["Destination cannot preserve exact access or deletion state"],
    original,
    access: { visibility: "private", linkRole: "none", shares: [] },
    comments: [{ id: "comment", body: "retained" }],
    identities: [],
    revisions: [1, 2].map((version) => ({
      version,
      original: {
        ...original,
        version,
        source: version === 1 ? "<p>Old</p>" : original.source,
      },
      conversion: {
        classification: "renderable",
        html: "<!doctype html><p>Preserved</p>",
        issues: [],
        identities: {},
      },
    })),
  };
  return {
    admission: {
      kind: "deleted-artifact-admission-v1",
      sourceNamespace: "archive-test",
      archiveDigest: "a".repeat(64),
      entries: [
        {
          legacyId: page.legacyId,
          pageId: page.pageId,
          headVersion: 2,
          deletedAt: original.deleted_at,
          artifactSha256: sha(original),
          revisions: page.revisions.map((r) => ({
            version: r.version,
            artifactSha256: sha(r.original),
          })),
        },
      ],
    },
    pages: [page],
    protectedPageIds: new Set(),
  };
}
test("deleted admission preserves all content and lifecycle while clearing only deletion refusal", () => {
  const input = fixture();
  const before = structuredClone(input.pages);
  const plan = prepareDeletedArtifactPlan(input);
  const page = plan.pages[0]!.page;
  assert.equal(page.disposition, "ready");
  assert.deepEqual(page.issues, []);
  assert.deepEqual(
    { ...page, disposition: "blocked", issues: before[0]!.issues },
    before[0],
  );
  assert.deepEqual(input.pages, before);
  assert.match(plan.pages[0]!.digest, /^[a-f0-9]{64}$/);
});
test("refuses changed source, omitted history, live rows, protected IDs, and duplicates", () => {
  const changes: ((i: DeletedArtifactPlanningInput) => void)[] = [
    (i) => {
      i.pages[0]!.original.source = "changed";
    },
    (i) => {
      (i.admission.entries as unknown[]).push(i.admission.entries[0]!);
    },
    (i) => {
      i.admission.entries[0]!.deletedAt = "invalid";
    },
    (i) => {
      i.admission.archiveDigest = "unsealed";
    },
    (i) => {
      i.pages[0]!.backendAllocation = {
        sourceNamespace: "different",
        inventorySha256: "b".repeat(64),
      };
    },
    (i) => {
      i.pages[0]!.revisions[0]!.conversion.classification = "manual-blocked";
    },
    (i) => {
      i.pages[0]!.revisions[0]!.original.source = "changed history";
    },
    (i) => {
      i.pages[0]!.revisions[0] = i.pages[0]!.revisions[1]!;
    },

    (i) => {
      i.pages[0]!.revisions.pop();
    },
    (i) => {
      i.admission.entries[0]!.revisions =
        i.admission.entries[0]!.revisions.slice(1);
    },
    (i) => {
      i.pages[0]!.original.deleted_at = null;
    },
    (i) => {
      (i.protectedPageIds as Set<string>).add(i.pages[0]!.pageId);
    },
    (i) => {
      (i.pages as PlannedPage[]).push(i.pages[0]!);
    },
    (i) => {
      i.pages[0]!.issues.push("Unsupported source");
    },
    (i) => {
      i.pages[0]!.revisions[0]!.conversion.issues = [
        "Unsupported format: script",
      ];
    },
    (i) => {
      i.pages[0]!.revisions[0]!.conversion.html = null;
    },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.throws(() => prepareDeletedArtifactPlan(input));
  }
});
test("retains transparent historical unavailability but refuses unavailable current heads", () => {
  const input = fixture();
  const old = input.pages[0]!.revisions[0]!;
  old.conversion = preserveUnavailableHistoricalRevision(
    old.original,
    {
      classification: "manual-blocked",
      html: null,
      issues: ["Unsupported format: old"],
      identities: {},
    },
    "/af/v1/core.js",
  );
  assert.equal(
    prepareDeletedArtifactPlan(input).pages[0]!.page.revisions[0]!.conversion,
    old.conversion,
  );
  input.pages[0]!.revisions[1]!.conversion = old.conversion;
  assert.throws(() => prepareDeletedArtifactPlan(input));
});
