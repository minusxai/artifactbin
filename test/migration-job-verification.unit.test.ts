import test from "node:test";
import assert from "node:assert/strict";
import type { PlannedPage } from "../src/migration/contracts.ts";
import { migrationPageDigest } from "../src/migration/import.ts";
import { prepareMigrationVerificationPages } from "../src/migration/job-verification.ts";
import { readPreparedMigrationPages } from "../src/migration/prepared-pages.ts";

function page(pageId: string): PlannedPage {
  return {
    legacyId: `Legacy${pageId}`,
    pageId,
    serverQueries: [
      {
        pageVersion: 1,
        moduleSourceSha256: "a".repeat(64),
        flowSourceSha256: "b".repeat(64),
        compilerIdentity: "compiler-v1",
        plan: {} as never,
      },
    ],
    backends: [
      {
        pageVersion: 1,
        linked: true,
        backendId: `Backend${pageId}`,
        deployment: { version: "c".repeat(64) },
      } as never,
    ],
    revisions: [
      {
        version: 1,
        conversion: {
          html: "<html><body>saved</body></html>",
          identities: {},
        } as never,
      } as never,
    ],
    identities: [],
  } as unknown as PlannedPage;
}

test("verification collects saved query registrations while runtime consumes each prepared page once", async () => {
  const pages = [page("Page01"), page("Page02")];
  let plannerCalls = 0;
  const maps = {
    pages: {
      LegacyPage01: "Page01",
      LegacyPage02: "Page02",
      LegacyBlocked: "Blocked01",
    },
    users: {},
    groups: {},
    tokens: {},
  };
  const source = {
    ids: ["LegacyPage01", "LegacyPage02", "LegacyBlocked"],
    maps,
    readArtifact: async () => ({}),
    manifest: { sourceNamespace: "source-ns" },
  } as never;
  const options = {
    legacyOrigins: [],
    origin: "https://example.test",
  } as never;
  const planned = {
    readiness: { ready: ["Page01", "Page02"] },
    pageDigests: new Map(pages.map((item) => [item.pageId, migrationPageDigest(item)])),
  } as never;
  const prepared = readPreparedMigrationPages(
    source,
    options,
    planned,
    async () => {
      const item = pages[plannerCalls++]!;
      return { pages: [item] } as never;
    },
  );
  const verification = prepareMigrationVerificationPages(
    prepared,
    "source-ns",
    "https://example.test",
  );
  const consumed: PlannedPage[] = [];
  for await (const item of verification.pages) consumed.push(item);

  assert.deepEqual(consumed, pages);
  assert.equal(plannerCalls, pages.length);
  assert.deepEqual(
    verification.queryRegistrations.map((registration) => ({
      sourceNamespace: registration.sourceNamespace,
      pageId: registration.plan.registration.pageId,
      backendId: registration.plan.registration.backendId,
      pageVersion: registration.plan.registration.pageVersion,
      moduleSourceSha256: registration.moduleSourceSha256,
    })),
    ["Page01", "Page02"].map((pageId) => ({
      sourceNamespace: "source-ns",
      pageId,
      backendId: `Backend${pageId}`,
      pageVersion: 1,
      moduleSourceSha256: "a".repeat(64),
    })),
  );
});

test("a preparation failure midway rejects the verification stream after prior registrations only", async () => {
  const first = page("Page01");
  async function* plannedPages() {
    yield first;
    throw Error("source changed during verification");
  }
  const verification = prepareMigrationVerificationPages(
    plannedPages(),
    "source-ns",
    "https://example.test",
  );
  const consumed: PlannedPage[] = [];
  await assert.rejects(async () => {
    for await (const item of verification.pages) consumed.push(item);
  }, /source changed during verification/);
  assert.deepEqual(consumed, [first]);
  assert.equal(verification.queryRegistrations.length, 1);
});
