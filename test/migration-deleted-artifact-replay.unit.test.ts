import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PlannedPage } from "../src/migration/contracts.ts";
import type { DeletedArtifactAdmission } from "../src/migration/deleted-artifact-contracts.ts";
import type { DeletedArtifactReplayManifest } from "../src/migration/deleted-artifact-job-contracts.ts";
import { prepareDeletedArtifactPlan } from "../src/migration/deleted-artifact-plan.ts";
import {
  deserializeDeletedArtifactReplayPage,
  serializeDeletedArtifactReplayPage,
  validateDeletedArtifactReplay,
} from "../src/migration/deleted-artifact-replay.ts";
import { applyDeletedArtifactReplay } from "../src/migration/deleted-artifact-apply.ts";
import { canonicalMigrationValue } from "../src/migration/verification-values.ts";

const sha = (value: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(value)).digest("hex");
function makePage(legacyId: string, pageId: string): PlannedPage {
  const original = {
    id: legacyId,
    format: "html",
    version: 1,
    user_id: "owner",
    group_id: null,
    token_id: null,
    source: `<p>${legacyId}</p>`,
    document: null,
    visibility: "private",
    link_role: null,
    deleted_at: "2024-01-02T03:04:05.000Z",
  };
  return {
    legacyId,
    pageId,
    owner: { kind: "user", id: "owner" },
    disposition: "blocked",
    issues: ["Destination cannot preserve exact access or deletion state"],
    original,
    access: { visibility: "private", linkRole: "none", shares: [] },
    comments: [],
    identities: [],
    serverQueries: undefined,
    revisions: [
      {
        version: 1,
        original,
        conversion: {
          classification: "renderable",
          html: `<!doctype html><p>${legacyId}</p>`,
          issues: [],
          identities: {},
        },
      },
    ],
  };
}
function fixture() {
  const pages = [
    makePage("legacy-a", "page-a"),
    makePage("legacy-b", "page-b"),
  ];
  const admission: DeletedArtifactAdmission = {
    kind: "deleted-artifact-admission-v1",
    sourceNamespace: "replay-test",
    archiveDigest: "a".repeat(64),
    entries: pages.map((page) => ({
      legacyId: page.legacyId,
      pageId: page.pageId,
      headVersion: 1,
      deletedAt: String(page.original.deleted_at),
      artifactSha256: sha(page.original),
      revisions: [
        { version: 1, artifactSha256: sha(page.revisions[0]!.original) },
      ],
    })),
  };
  const plan = prepareDeletedArtifactPlan({
    admission,
    pages,
    protectedPageIds: new Set(),
  });
  const persistedEntries = plan.pages;
  const persistedPlan = { ...plan, pages: persistedEntries };
  const bodyByLegacy = new Map<string, Uint8Array>();
  const refs = persistedEntries.map((entry) => {
    const body = Buffer.from(serializeDeletedArtifactReplayPage(entry));
    assert.deepEqual(deserializeDeletedArtifactReplayPage(body), entry);
    bodyByLegacy.set(entry.page.legacyId, new Uint8Array(body));
    return {
      legacyId: entry.page.legacyId,
      pageId: entry.page.pageId,
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  });
  const manifest: DeletedArtifactReplayManifest = {
    kind: "deleted-artifact-replay-plan-v1",
    sourceNamespace: plan.sourceNamespace,
    archiveDigest: plan.archiveDigest,
    admissionSha256: plan.admissionSha256,
    pageCount: plan.pages.length,
    revisionCount: persistedEntries.reduce(
      (n, p) => n + p.page.revisions.length,
      0,
    ),
    canonicalPlanSha256: sha(persistedPlan),
    pages: refs,
  };
  return {
    admission,
    plan,
    persistedEntries,
    manifest,
    bodyByLegacy,
    source: {
      read: async (ref: { legacyId: string }) =>
        bodyByLegacy.get(ref.legacyId)!,
    },
  };
}

test("replay preflight checks complete coverage and streams the exact canonical full-plan digest", async () => {
  const f = fixture();
  const replay = await validateDeletedArtifactReplay({
    manifest: f.manifest,
    admission: f.admission,
    source: f.source,
    protectedPageIds: new Set(),
  });
  const actual = [];
  for await (const entry of replay.pages()) actual.push(entry);
  assert.deepEqual(actual, f.persistedEntries);
});

test("replay refuses a changed page file before returning a usable source", async () => {
  const f = fixture();
  const first = f.manifest.pages[0]!;
  f.bodyByLegacy.set(
    first.legacyId,
    new Uint8Array(
      Buffer.from(
        JSON.stringify({ page: f.plan.pages[0]!.page, digest: "0".repeat(64) }),
      ),
    ),
  );
  await assert.rejects(
    validateDeletedArtifactReplay({
      manifest: f.manifest,
      admission: f.admission,
      source: f.source,
      protectedPageIds: new Set(),
    }),
    /Invalid deleted artifact replay plan/,
  );
});

test("replay snapshot and lossless object codec resist authority mutation and prototype keys", async () => {
  const f = fixture();
  const validated = await validateDeletedArtifactReplay({
    manifest: f.manifest,
    admission: f.admission,
    source: f.source,
    protectedPageIds: new Set(),
  });
  const originalPageId = validated.manifest.pages[0]!.pageId;
  f.manifest.pages[0]!.pageId = "attacker-page";
  f.admission.entries[0]!.pageId = "attacker-page";
  assert.equal(validated.manifest.pages[0]!.pageId, originalPageId);
  assert.equal(Object.isFrozen(validated.manifest.pages[0]), true);
  const replayed = await validated.pages().next();
  assert.equal(replayed.value?.page.pageId, originalPageId);

  const entry = structuredClone(f.persistedEntries[0]!);
  const special = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(special, "$deletedArtifactReplayType", {
    value: "ordinary-user-value",
    enumerable: true,
  });
  Object.defineProperty(special, "__proto__", {
    value: { constructor: "kept" },
    enumerable: true,
  });
  entry.page.original.document = special;
  const decoded = deserializeDeletedArtifactReplayPage(
    serializeDeletedArtifactReplayPage(entry),
  );
  const document = decoded.page.original.document as Record<string, unknown>;
  assert.equal(Object.hasOwn(document, "__proto__"), true);
  assert.deepEqual(document.__proto__, { constructor: "kept" });
  assert.equal(document.$deletedArtifactReplayType, "ordinary-user-value");
  const duplicate = Buffer.from(
    '{"$deletedArtifactReplayType":"object","entries":[["x",1],["x",2]]}',
  );
  assert.throws(
    () => deserializeDeletedArtifactReplayPage(duplicate),
    /Invalid deleted artifact replay plan/,
  );
});

test("replay page codec accepts the observed 45.9 MB persisted page without a cache-size cap", () => {
  const targetBytes = 45_922_484;
  const prefix = Buffer.from(
    `{"page":{},"digest":"${"a".repeat(64)}"}`,
    "utf8",
  );
  const checkpoint = Buffer.concat([
    prefix,
    Buffer.alloc(targetBytes - prefix.byteLength, 0x20),
  ]);
  assert.equal(checkpoint.byteLength, targetBytes);
  assert.equal(
    deserializeDeletedArtifactReplayPage(checkpoint).digest,
    "a".repeat(64),
  );
});

test("replay refuses omitted, reordered, or mismatched manifest coverage", async () => {
  const f = fixture();
  const omitted = {
    ...f.manifest,
    pages: f.manifest.pages.slice(0, 1),
    pageCount: 1,
  };
  await assert.rejects(
    validateDeletedArtifactReplay({
      manifest: omitted,
      admission: f.admission,
      source: f.source,
      protectedPageIds: new Set(),
    }),
  );
  const reordered = { ...f.manifest, pages: [...f.manifest.pages].reverse() };
  await assert.rejects(
    validateDeletedArtifactReplay({
      manifest: reordered,
      admission: f.admission,
      source: f.source,
      protectedPageIds: new Set(),
    }),
  );
  const mismatched = {
    ...f.manifest,
    pages: f.manifest.pages.map((ref, i) =>
      i ? ref : { ...ref, pageId: "other" },
    ),
  };
  await assert.rejects(
    validateDeletedArtifactReplay({
      manifest: mismatched,
      admission: f.admission,
      source: f.source,
      protectedPageIds: new Set(),
    }),
  );
});

test("replay applies one page at a time, then runs metadata and full replay verification", async () => {
  const f = fixture();
  const validated = await validateDeletedArtifactReplay({
    manifest: f.manifest,
    admission: f.admission,
    source: f.source,
    protectedPageIds: new Set(),
  });
  const events: string[] = [];
  let preparedPublications: readonly Record<string, unknown>[] = [];
  const destination = {
    prepareDeleted: async (input: { publications?: readonly Record<string, unknown>[] }) => {
      events.push("prepare");
      preparedPublications = input.publications ?? [];
    },
    supportsExactDeletedAccess: () => true,
    importDeletedPage: async (key: string) => {
      events.push(`page:${key}`);
      return "created" as const;
    },
  };
  const result = await applyDeletedArtifactReplay({
    validated,
    maps: {
      pages: { "legacy-a": "page-a", "legacy-b": "page-b" },
      users: {},
      groups: {},
      tokens: {},
    },
    destination,
    verifyProtectedState: async () => {
      events.push("protected");
    },
    importMetadata: async () => {
      events.push("metadata");
    },
    verifyDeletedState: async (_manifest, pages) => {
      let count = 0;
      for await (const page of pages) {
        events.push(`verify:${page.legacyId}`);
        count += page.revisions.length;
      }
      return {
        pages: 2,
        sources: count,
        comments: 0,
        snapshots: 0,
        assets: 0,
        backendLinks: 0,
        normalizedBytes: 0,
      };
    },
  });
  assert.equal(result.complete, true);
  assert.deepEqual(
    preparedPublications.map(({ legacyId, pageId, headVersion, deletedAt, artifactSha256 }) => ({
      legacyId,
      pageId,
      headVersion,
      deletedAt,
      artifactSha256,
    })),
    f.admission.entries.map(({ legacyId, pageId, headVersion, deletedAt, artifactSha256 }) => ({
      legacyId,
      pageId,
      headVersion,
      deletedAt,
      artifactSha256,
    })),
  );
  assert.equal(result.pages, 2);
  assert.equal(result.revisions, 2);
  assert.deepEqual(events, [
    "prepare",
    "protected",
    "page:replay-test:legacy-a",
    "page:replay-test:legacy-b",
    "metadata",
    "verify:legacy-a",
    "verify:legacy-b",
    "protected",
  ]);
});

test("replay rechecks bytes after preflight and withholds metadata and success on a changed page", async () => {
  const f = fixture();
  const validated = await validateDeletedArtifactReplay({
    manifest: f.manifest,
    admission: f.admission,
    source: f.source,
    protectedPageIds: new Set(),
  });
  const last = f.manifest.pages.at(-1)!;
  f.bodyByLegacy.set(last.legacyId, new Uint8Array(Buffer.from("{}")));
  const events: string[] = [];
  const destination = {
    prepareDeleted: async () => {
      events.push("prepare");
    },
    supportsExactDeletedAccess: () => true,
    importDeletedPage: async (key: string) => {
      events.push(`page:${key}`);
      return "created" as const;
    },
  };
  await assert.rejects(
    applyDeletedArtifactReplay({
      validated,
      maps: {
        pages: { "legacy-a": "page-a", "legacy-b": "page-b" },
        users: {},
        groups: {},
        tokens: {},
      },
      destination,
      verifyProtectedState: async () => {
        events.push("protected");
      },
      importMetadata: async () => {
        events.push("metadata");
      },
      verifyDeletedState: async () => {
        events.push("verify");
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
    }),
  );
  assert.deepEqual(events, [
    "prepare",
    "protected",
    "page:replay-test:legacy-a",
  ]);
});
