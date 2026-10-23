import assert from "node:assert/strict";
import test from "node:test";
import type { PlannedPage } from "../src/migration/contracts.ts";
import type { DeletedArtifactApplyInput } from "../src/migration/deleted-artifact-contracts.ts";
import { migrationPageDigest } from "../src/migration/import.ts";
import { applyDeletedArtifactPlan } from "../src/migration/deleted-artifact-apply.ts";
function fixture() {
  const calls: string[] = [];
  const pages = ["first", "second"].map((id) => {
    const original = {
      id,
      format: "html",
      version: 1,
      user_id: null,
      group_id: null,
      token_id: null,
      source: "<p>Retained</p>",
      document: null,
      visibility: "private",
      link_role: null,
      deleted_at: "2024-01-01T00:00:00Z",
    };
    const page: PlannedPage = {
      legacyId: id,
      pageId: `page-${id}`,
      disposition: "ready",
      issues: [],
      owner: null,
      access: { visibility: "private", linkRole: "none", shares: [] },
      original,
      revisions: [
        {
          version: 1,
          original,
          conversion: {
            classification: "renderable",
            html: "<p>Retained</p>",
            issues: [],
            identities: {},
          },
        },
      ],
      identities: [],
      comments: [],
    };
    return { page, digest: migrationPageDigest(page) };
  });
  const input: DeletedArtifactApplyInput = {
    plan: {
      kind: "deleted-artifact-plan-v1",
      sourceNamespace: "test",
      archiveDigest: "a".repeat(64),
      admissionSha256: "b".repeat(64),
      pages,
    },
    maps: {
      pages: Object.fromEntries(
        pages.map(({ page }) => [page.legacyId, page.pageId]),
      ),
      users: {},
      groups: {},
      tokens: {},
    },
    destination: {
      async prepareDeleted() {
        calls.push("prepare");
      },
      supportsExactDeletedAccess(page) {
        calls.push(`support:${page.legacyId}`);
        return true;
      },
      async importDeletedPage(key) {
        calls.push(`write:${key}`);
        return "created";
      },
    },
    async verifyProtectedState() {
      calls.push("protected");
    },
    async importMetadata() { calls.push("metadata"); },
    async verifyDeletedState() {
      calls.push("verify");
      return {
        pages: 2,
        sources: 2,
        comments: 0,
        snapshots: 0,
        assets: 0,
        backendLinks: 0,
        normalizedBytes: 0,
      };
    },
  };
  return { input, calls };
}
test("writes only after full preflight and reports completion only after both verifications", async () => {
  const { input, calls } = fixture();
  const result = await applyDeletedArtifactPlan(input);
  assert.deepEqual(calls, [
    "prepare",
    "support:first",
    "support:second",
    "protected",
    "write:test:first",
    "write:test:second",
    "metadata",
    "verify",
    "protected",
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.created, 2);
  assert.equal(result.revisions, 2);
  input.destination.importDeletedPage = async () => "unchanged";
  const retried = await applyDeletedArtifactPlan(input);
  assert.equal(retried.unchanged, 2);
  assert.equal(retried.created, 0);
});
test("rejects invalid bindings and changed plans before connecting", async () => {
  const changes: ((i: DeletedArtifactApplyInput) => void)[] = [
    (i) => {
      i.plan.pages[0]!.page.original.source = "mutated";
    },
    (i) => {
      i.maps.pages.first = "wrong";
    },
    (i) => {
      i.plan.archiveDigest = "invalid";
    },
    (i) => {
      i.plan.pages = [];
    },
    (i) => {
      i.plan.pages = [i.plan.pages[0]!, i.plan.pages[0]!];
    },
  ];
  for (const change of changes) {
    const { input, calls } = fixture();
    change(input);
    await assert.rejects(applyDeletedArtifactPlan(input));
    assert.deepEqual(calls, []);
  }
});
test("preparation, access, and protected-state failures prevent all writes", async () => {
  for (const stage of ["prepare", "support", "protected"]) {
    const { input, calls } = fixture();
    if (stage === "prepare")
      input.destination.prepareDeleted = async () => {
        throw Error("archive mismatch");
      };
    if (stage === "support")
      input.destination.supportsExactDeletedAccess = (page) =>
        page.legacyId !== "second";
    if (stage === "protected")
      input.verifyProtectedState = async () => {
        throw Error("protected mismatch");
      };
    await assert.rejects(applyDeletedArtifactPlan(input));
    assert.equal(
      calls.some((c) => c.startsWith("write:")),
      false,
    );
  }
});
test("later write failure retains its cause and never claims verification or success", async () => {
  const { input, calls } = fixture();
  const cause = Error("write rejected");
  input.destination.importDeletedPage = async (key) => {
    calls.push(`write:${key}`);
    if (key.endsWith("second")) throw cause;
    return "created";
  };
  await assert.rejects(
    applyDeletedArtifactPlan(input),
    (error) => error instanceof Error && error.cause === cause,
  );
  assert.equal(calls.includes("write:test:first"), true);
  assert.equal(calls.includes("verify"), false);
});
test("verification count mismatch and final protected mismatch fail completion", async () => {
  for (const stage of ["pages", "sources", "protected"]) {
    const { input } = fixture();
    const verify = input.verifyDeletedState;
    input.verifyDeletedState = async (plan) => ({
      ...(await verify(plan)),
      ...(stage === "pages"
        ? { pages: 1 }
        : stage === "sources"
          ? { sources: 1 }
          : {}),
    });
    let count = 0;
    input.verifyProtectedState = async () => {
      if (++count === 2 && stage === "protected")
        throw Error("protected changed");
    };
    await assert.rejects(applyDeletedArtifactPlan(input));
  }
});

test("metadata failure cannot produce verified completion after page commits", async () => {
 const {input,calls}=fixture(); input.importMetadata=async()=>{calls.push("metadata");throw Error("metadata failed");};
 await assert.rejects(applyDeletedArtifactPlan(input),/metadata failed/);
 assert.equal(calls.filter(c=>c.startsWith("write:")).length,2);
 assert.equal(calls.includes("verify"),false);
});
