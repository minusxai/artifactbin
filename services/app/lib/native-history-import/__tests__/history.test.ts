import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import { identityForUser } from "@/lib/accounts";
import { readHtmlPage } from "@/lib/html-publication";
import { canonicalizeHtmlPage } from "@/lib/html-page";
import { getHtmlBackendVersion } from "@/lib/html-backends";
import {
  prepareRegisteredQueryBackend,
  pageSourceDigest,
  registeredPlan,
} from "@/lib/registered-page-queries/registry";
import {
  prepareRegisteredMutationBackend,
  registeredMutationPlan,
} from "@/lib/registered-page-mutations";
import type { NativeHistoryImport, NativeHistoryRevision } from "../contracts";
import { listAnnotationsFor } from "@/lib/annotations/store";
import { prepareNativeHistoryRelations } from "../relations";
import { importNativeHistory, writeNativeHistory } from "../index";
useAppHarness();
async function fixture() {
  const owner = await mintAccountToken("synthetic_history_owner"),
    db = await getDb();
  const revisions: NativeHistoryRevision[] = [1, 3].map((version) => {
    const canonical = canonicalizeHtmlPage(
      `<html><head></head><body><p data-af-id="stable">Version ${version}</p></body></html>`,
    );
    const page = {
      pageId: "TestHistory",
      version,
      revision: String(version),
      html: canonical.html,
      nextNodeId: canonical.ledger.nextNodeId,
      links: [] as NativeHistoryRevision["page"]["links"],
    };
    const provenance = {
      compilerSha256: "a".repeat(64),
      sourceSha256: "b".repeat(64),
      sqlEngineSha256: "c".repeat(64),
    };
    const query = prepareRegisteredQueryBackend(
      "queries",
      "history_queries",
      page,
      {
        scalars: {},
        queries: [
          { name: "result", sql: "SELECT 1 AS value", dependencies: [] },
        ],
        imports: [],
      },
      provenance,
    );
    const mutation = prepareRegisteredMutationBackend(
      "actions",
      "history_actions",
      page,
      {
        name: "save",
        kind: "insert",
        sql: "INSERT INTO forms.rows(body) VALUES ($body)",
        target: {
          datasetId: "SyntheticDataset",
          schema: "forms",
          table: "rows",
        },
        values: {
          body: { type: "string", nullable: false, parameter: "body" },
        },
        builtins: [],
        expectedAffected: 1,
        reset: ["body"],
      },
      provenance,
    );
    page.links = [query.link, mutation.link];
    return {
      page,
      ledger: canonical.ledger,
      sourceSha256: pageSourceDigest(page.html),
      title: `Revision ${version}`,
      description: null,
      createdAt: `2020-01-0${version}T00:00:00.000Z`,
      actorUserId: owner.userId,
      actorTokenId: owner.id,
      queries: [query],
      mutations: [mutation],
    };
  });
  const input: NativeHistoryImport = {
    sourceNamespace: "synthetic-selection",
    sourceId: "old-source",
    selectionSha256: "d".repeat(64),
    projectionSha256: "e".repeat(64),
    pageId: "TestHistory",
    owner: { userId: owner.userId!, tokenId: owner.id },
    visibility: "private",
    linkRole: "viewer",
    shares: [],
    headVersion: 3,
    revisions,
  };
  return { db, input, actor: identityForUser(owner.userId, owner.id) };
}
it("publishes sparse immutable histories with real registry helpers and replays only identical imports", async () => {
  const { db, input, actor } = await fixture();
  expect(await importNativeHistory(db, input)).toBe("created");
  for (const revision of input.revisions) {
    const saved = await readHtmlPage(
      actor,
      input.pageId,
      String(revision.page.version),
    );
    expect(saved).toEqual(revision.page);
    for (const [prepared, validate] of [
      [revision.queries[0]!, registeredPlan],
      [revision.mutations[0]!, registeredMutationPlan],
    ] as const) {
      const backend = (await getHtmlBackendVersion(
        prepared.link.backendId,
        prepared.link.version,
      ))!;
      expect(
        validate(saved, prepared.link, backend)?.registration.pageVersion,
      ).toBe(revision.page.version);
    }
  }
  expect(
    (
      await db.query(
        "SELECT version FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",
        [input.pageId],
      )
    ).rows,
  ).toEqual([{ version: 1 }, { version: 3 }]);
  expect(await importNativeHistory(db, input)).toBe("unchanged");
  await expect(
    db.transaction((tx) =>
      writeNativeHistory(tx, { ...input, projectionSha256: "f".repeat(64) }),
    ),
  ).rejects.toThrow("native_import_collision");
});
it("rejects changed source and incomplete head selection without leaving rows", async () => {
  const { db, input } = await fixture();
  for (const bad of [
    { ...input, headVersion: 2 },
    {
      ...input,
      revisions: input.revisions.map((r, i) =>
        i ? { ...r, page: { ...r.page, html: r.page.html + "changed" } } : r,
      ),
    },
  ])
    await expect(
      db.transaction((tx) => writeNativeHistory(tx, bad)),
    ).rejects.toThrow();
  expect(
    (await db.query("SELECT id FROM artifacts WHERE id=$1", [input.pageId]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await db.query("SELECT backend_id FROM html_backend_versions")).rows,
  ).toHaveLength(0);
});
it("rolls back page, sparse history and earlier programs when a later registration fails", async () => {
  const { db, input } = await fixture();
  const changed = structuredClone(input);
  changed.revisions[1]!.mutations[0]!.backend.compiled += "tampered";
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, changed)),
  ).rejects.toThrow();
  for (const table of [
    "artifacts",
    "artifact_versions",
    "html_backend_versions",
    "artifact_id_registry",
  ])
    expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});

it("never consumes an existing reservation and requires declared relation projection in the same transaction", async () => {
  const { db, input } = await fixture();
  await db.query("INSERT INTO artifact_id_registry(id,owner) VALUES($1,$2)", [
    input.pageId,
    "different-owner",
  ]);
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, input)),
  ).rejects.toThrow("native_import_collision");
  expect(
    (await db.query("SELECT consumed,owner FROM artifact_id_registry")).rows,
  ).toEqual([{ consumed: false, owner: "different-owner" }]);
  await db.query("DELETE FROM artifact_id_registry WHERE id=$1", [
    input.pageId,
  ]);
  const projected = { ...input, relationSha256: "f".repeat(64) };
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, projected)),
  ).rejects.toThrow("native_import_invalid");
  let reached = false;
  await expect(
    db.transaction((tx) =>
      writeNativeHistory(tx, projected, {
        sourceSha256: projected.relationSha256,
        apply: async (tx) => {
          reached = true;
          expect(
            (
              await tx.query(
                "SELECT version FROM artifact_versions ORDER BY version",
              )
            ).rows,
          ).toEqual([{ version: 1 }, { version: 3 }]);
        },
        verify: async () => {
          throw Error("relation_projection_changed");
        },
      }),
    ),
  ).rejects.toThrow("relation_projection_changed");
  expect(reached).toBe(true);
  for (const table of [
    "artifacts",
    "artifact_versions",
    "html_backend_versions",
    "artifact_id_registry",
  ])
    expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});

it("preserves private reach and fails replay after destination sharing changes", async () => {
  const { db, input, actor } = await fixture();
  const reader = await mintAccountToken("synthetic_history_reader");
  const shared = {
    ...input,
    shares: [{ email: reader.email!, role: "viewer" as const }],
  };
  await db.transaction((tx) => writeNativeHistory(tx, shared));
  await expect(
    readHtmlPage(
      { userId: null, tokenId: null, email: null, documentEditor: false },
      input.pageId,
    ),
  ).rejects.toThrow();
  expect(
    (
      await readHtmlPage(
        { ...identityForUser(reader.userId, reader.id), email: reader.email },
        input.pageId,
      )
    ).version,
  ).toBe(3);
  await db.query("UPDATE artifacts SET visibility='public' WHERE id=$1", [
    input.pageId,
  ]);
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, shared)),
  ).rejects.toThrow("native_import_collision");
  expect((await readHtmlPage(actor, input.pageId)).version).toBe(3);
});

for (const [table, column, value] of [
  ["artifacts", "title", "'changed'"],
  ["artifacts", "description", "'changed'"],
  ["artifacts", "actor_user_id", "NULL"],
  ["artifacts", "creator_user_id", "NULL"],
  ["artifacts", "document", "'{}'::jsonb"],
  ["artifacts", "actor_token_id", "NULL"],
  ["artifacts", "created_at", "now()"],
  ["artifacts", "updated_at", "now()"],
  ["artifacts", "updated_at", "updated_at + interval '1 microsecond'"],
  ["artifacts", "meta", "jsonb_set(meta,'{htmlIdentity,nextNodeId}','999')"],
  ["artifact_versions", "title", "'changed'"],
  ["artifact_versions", "description", "'changed'"],
  ["artifact_versions", "actor_user_id", "NULL"],
  ["artifact_versions", "actor_token_id", "NULL"],
  ["artifact_versions", "created_at", "now()"],
  ["artifact_versions", "created_at", "created_at + interval '1 microsecond'"],
  ["artifact_versions", "format", "'markup'"],
  ["artifact_versions", "document", "'{}'::jsonb"],
  ["artifact_versions", "meta", "jsonb_set(meta,'{htmlIdentity,nextNodeId}','999')"],
  ["artifact_source_ids", "first_version", "99"],
  ["artifact_source_ids", "retired_version", "99"],
] as const) it(`rejects replay after ${table}.${column} changes`, async () => {
  const { db, input } = await fixture();
  await importNativeHistory(db, input);
  await db.query(`UPDATE ${table} SET ${column}=${value}`);
  await expect(importNativeHistory(db, input)).rejects.toThrow("native_import_collision");
});

it("verifies created history after relation projection in the same transaction", async () => {
  const { db, input } = await fixture();
  await expect(importNativeHistory(db, {...input, relationSha256: "f".repeat(64)}, {
    sourceSha256: "f".repeat(64),
    apply: async tx => { await tx.query("UPDATE artifact_versions SET title='changed'"); },
    verify: async () => {},
  })).rejects.toThrow("native_import_collision");
  expect((await db.query("SELECT id FROM artifacts")).rows).toHaveLength(0);
});


it("preserves a retained identity restored after an intervening absence", async () => {
  const { db, input } = await fixture();
  const middle = structuredClone(input.revisions[0]!);
  middle.page.version = 2;
  middle.page.revision = "2";
  middle.page.html = middle.page.html.replace(/<p[^>]*>.*?<\/p>/, "");
  middle.page.links = [];
  middle.queries = [];
  middle.mutations = [];
  middle.sourceSha256 = pageSourceDigest(middle.page.html);
  const changed = {...input, revisions: [input.revisions[0]!, middle, input.revisions[1]!]};
  expect(await importNativeHistory(db, changed)).toBe("created");
  expect(await importNativeHistory(db, changed)).toBe("unchanged");
  expect((await db.query("SELECT first_version,retired_version FROM artifact_source_ids WHERE source_id='stable'")).rows).toEqual([{first_version: 1, retired_version: null}]);
});

it("rejects regressing lifetime allocation ledgers and counters", async () => {
  const { db, input } = await fixture();
  for (const ledger of [
    {...input.revisions[1]!.ledger, allocatedIds: input.revisions[1]!.ledger.allocatedIds.filter(id => id !== "reserved")},
    {...input.revisions[1]!.ledger, nextNodeId: 1},
  ]) {
    const first = {...input.revisions[0]!, ledger: {...input.revisions[0]!.ledger, allocatedIds: [...input.revisions[0]!.ledger.allocatedIds, "reserved"]}};
    const last = {...input.revisions[1]!, ledger, page: {...input.revisions[1]!.page, nextNodeId: ledger.nextNodeId}};
    await expect(importNativeHistory(db, {...input, revisions: [first,last]})).rejects.toThrow("native_import_invalid");
  }
});

it("retains exact per-version publication receipts and rejects changed receipts", async () => {
  const { db, input } = await fixture();
  const receipts = [{path: "image.png", kind: "asset" as const, id: "SyntheticAsset", revision: "7", sha256: "a".repeat(64)}];
  const projected = {...input, revisions: input.revisions.map((r,i) => ({...r, htmlPublicationDependencies: i ? [] : receipts}))};
  expect(await importNativeHistory(db, projected)).toBe("created");
  expect((await db.query("SELECT meta->'htmlPublicationDependencies' AS receipts FROM artifact_versions ORDER BY version")).rows).toEqual([{receipts}, {receipts: []}]);
  expect((await db.query("SELECT meta->'htmlPublicationDependencies' AS receipts FROM artifacts")).rows).toEqual([{receipts: []}]);
  expect(await importNativeHistory(db, projected)).toBe("unchanged");
  await db.query("UPDATE artifact_versions SET meta=jsonb_set(meta,'{htmlPublicationDependencies}','[]') WHERE version=1");
  await expect(importNativeHistory(db, projected)).rejects.toThrow("native_import_collision");
});

it("composes historical metadata and real retained annotation context without admitting unknown metadata", async () => {
  const {db, input, actor} = await fixture();
  const context = {status: "available", originalRevision: "1"};
  const relations = prepareNativeHistoryRelations({history: input,
    bindings: [{version: 1, htmlSha256: input.revisions[0]!.sourceSha256, sourceNamespace: "graph", sourceNodeId: "original", nodeId: "stable"}],
    annotations: [{id: "retained", revision: 1, rootId: null, body: "Retained comment", authorKind: "human", authorTokenId: input.owner.tokenId,
      authorUserId: input.owner.userId, authorLabel: "Original author", authorTransport: "browser", status: "open", resolvedAt: null,
      createdAt: input.revisions[0]!.createdAt, editedAt: null, deletedAt: null, changeSeq: null, authorRemote: null,
      snippet: "Version", quote: "Version", range: null, viewState: {v: 2, state: {$: {filter: "saved"}}}, retainedContext: context,
      anchor: {version: 1, sourceNamespace: "graph", sourceNodeId: "original", quote: "Version"}}], members: [], images: []});
  const projected = {...input, relationSha256: relations.sourceSha256};
  expect(await importNativeHistory(db, projected, relations)).toBe("created");
  expect(await importNativeHistory(db, projected, relations)).toBe("unchanged");
  expect((await listAnnotationsFor(actor, input.pageId, {status: "all"}))?.[0]).toMatchObject({id: "retained", anchor_version: 1, anchor: {kind: "html-node", revision: "1", nodeId: "stable"}, view_state: {v: 2, state: {$: {filter: "saved"}}}});
  for (const revision of input.revisions) expect(await readHtmlPage(actor, input.pageId, String(revision.page.version))).toEqual(revision.page);
  await db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{unexpected}', 'true')");
  await expect(importNativeHistory(db, projected, relations)).rejects.toThrow("native_import_collision");
  await db.query("UPDATE artifacts SET meta=meta-'unexpected'");
  await db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{nativeRelationContext}', '[]')");
  await expect(importNativeHistory(db, projected, relations)).rejects.toThrow();
});
