import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken, request } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import type { Queryable } from "@/lib/platform/db";
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
import { artifactPageAnswer } from "@/lib/document-serving/artifact-page";
useAppHarness();
it("writes a large latest-only lifetime ledger in bounded statements and verifies every reservation on replay", async () => {
  const {db,input} = await fixture();
  const revision = structuredClone(input.revisions[1]!);
  revision.page.version = 20;
  revision.page.revision = "20";
  revision.page.links = [];
  revision.queries = [];
  revision.mutations = [];
  const reserved = Array.from({length:512}, (_,index)=>`reserved_${index}`);
  revision.ledger = {...revision.ledger,allocatedIds:[...revision.ledger.allocatedIds,...reserved]};
  const latest = {...input,headVersion:20,revisions:[revision]};
  const writes:string[] = [];
  expect(await db.transaction(tx=>{
    const measured:Queryable = {query:<T>(sql:string,params?:unknown[])=>{
      if(/\b(?:INSERT INTO|UPDATE) artifact_source_ids\b/i.test(sql))writes.push(sql);
      return tx.query<T>(sql,params);
    }};
    return writeNativeHistory(measured,latest);
  })).toBe("created");
  const stored = (await db.query<{source_id:string;provenance:string;first_version:number;retired_version:number|null}>("SELECT source_id,provenance,first_version,retired_version FROM artifact_source_ids WHERE artifact_id=$1",[latest.pageId])).rows;
  expect(new Set(stored.map(row=>row.source_id))).toEqual(new Set(revision.ledger.allocatedIds));
  for(const row of stored)expect(row).toEqual({source_id:row.source_id,provenance:"authored",first_version:20,retired_version:reserved.includes(row.source_id)?20:null});
  expect(await importNativeHistory(db,latest)).toBe("unchanged");
  await db.query("UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=$2",[latest.pageId,reserved[0]]);
  await expect(importNativeHistory(db,latest)).rejects.toThrow("native_import_collision");
  // The createArtifact genesis reservation and one complete ledger batch are bounded independently of ID count.
  expect(writes.length).toBeLessThanOrEqual(2);
});
async function fixture(pageId = "TestHistory") {
  const owner = await mintAccountToken("synthetic_history_owner"),
    db = await getDb();
  const revisions: NativeHistoryRevision[] = [1, 3].map((version) => {
    const canonical = canonicalizeHtmlPage(
      `<html><head></head><body><p data-af-id="stable">Version ${version}</p></body></html>`,
    );
    const page = {
      pageId,
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
      `history_${pageId}_queries`,
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
      `history_${pageId}_actions`,
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
    pageId,
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
it("preserves validated legacy template metadata on native HTML imports and rejects unknown templates", async () => {
  const { db, input, actor } = await fixture();
  input.revisions[1]!.template = "doc";
  expect(await importNativeHistory(db, input)).toBe("created");
  const current = (await db.query<{meta: Record<string, unknown> }>(
    "SELECT meta FROM artifacts WHERE id=$1", [input.pageId],
  )).rows[0]!;
  const version = (await db.query<{meta: Record<string, unknown> }>(
    "SELECT meta FROM artifact_versions WHERE artifact_id=$1 AND version=3", [input.pageId],
  )).rows[0]!;
  expect(current.meta.template).toBe("doc");
  expect(version.meta.template).toBe("doc");
  const page = await artifactPageAnswer(
    request(`/a/${input.pageId}`, { actor: { credential: "session", userId: actor.userId!, email: actor.email ?? undefined } }),
    input.pageId,
  );
  expect(page.body).toMatchObject({ surface: { format: "html", template: "doc" } });

  await db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{template}','\"landing\"'::jsonb) WHERE id=$1", [input.pageId]);
  await expect(importNativeHistory(db, input)).rejects.toThrow("native_import_collision");
  await db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{template}','\"doc\"'::jsonb) WHERE id=$1", [input.pageId]);

  input.revisions[1]!.template = "not-a-template";
  await expect(importNativeHistory(db, input)).rejects.toThrow("native_import_invalid");
  const unchanged = (await db.query<{meta: Record<string, unknown> }>(
    "SELECT meta FROM artifacts WHERE id=$1", [input.pageId],
  )).rows[0]!;
  expect(unchanged.meta.template).toBe("doc");
});
it("distinguishes absent and explicitly null source template metadata", async () => {
  for (const [pageId, value, expected] of [
    ["TestTemplateAbsent", undefined, undefined],
    ["TestTemplateNull", null, null],
  ] as const) {
    const { db, input } = await fixture(pageId);
    if (value !== undefined) input.revisions[1]!.template = value;
    expect(await importNativeHistory(db, input)).toBe("created");
    const row = (await db.query<{meta: Record<string, unknown> }>(
      "SELECT meta FROM artifacts WHERE id=$1", [pageId],
    )).rows[0]!;
    expect(Object.hasOwn(row.meta, "template")).toBe(value !== undefined);
    expect(row.meta.template).toBe(expected);
  }
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

it("imports and replays a latest human-owned page with no creator token and preserves private access",async()=>{
 const {db,input,actor}=await fixture();
 const revision=structuredClone(input.revisions.at(-1)!);revision.actorTokenId=null;
 const latest={...input,owner:{...input.owner,tokenId:null},revisions:[revision]};
 const tokenCount=(await db.query("SELECT id FROM tokens")).rows.length;
 expect(await importNativeHistory(db,latest)).toBe("created");
 expect(await importNativeHistory(db,latest)).toBe("unchanged");
 expect((await db.query("SELECT user_id,creator_user_id,token_id,actor_token_id,visibility FROM artifacts WHERE id=$1",[latest.pageId])).rows).toEqual([{user_id:input.owner.userId,creator_user_id:input.owner.userId,token_id:null,actor_token_id:null,visibility:"private"}]);
 expect((await db.query("SELECT id FROM tokens")).rows).toHaveLength(tokenCount);
 expect(await readHtmlPage({...actor,tokenId:null},latest.pageId,String(latest.headVersion))).toEqual(revision.page);
 await expect(readHtmlPage({userId:null,tokenId:null,email:null,documentEditor:false},latest.pageId,String(latest.headVersion))).rejects.toThrow();
});
it("rolls back tokenless imports after verification failure and rejects unknown human owners",async()=>{
 const {db,input}=await fixture();const revision=structuredClone(input.revisions.at(-1)!);revision.actorTokenId=null;
 const latest={...input,owner:{...input.owner,tokenId:null},revisions:[revision]};
 await expect(db.transaction(async tx=>{await writeNativeHistory(tx,latest);throw Error("post_verify_failure");})).rejects.toThrow("post_verify_failure");
 for(const table of ["artifacts","artifact_versions","artifact_id_registry","html_backend_versions"])expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
 await expect(importNativeHistory(db,{...latest,owner:{userId:"unmapped-human",tokenId:null}})).rejects.toThrow("native_import_invalid");
 expect((await db.query("SELECT * FROM artifact_id_registry")).rows).toHaveLength(0);
});
it("normal creation rejects an absent human and absent token",async()=>{
 const {createArtifact}=await import("@/lib/artifacts");
 await expect(createArtifact(null,null,{format:"html",source:"<html><body>Unowned</body></html>",meta:{}})).rejects.toThrow();
 expect((await (await getDb()).query("SELECT * FROM artifacts")).rows).toHaveLength(0);
});

it("the declared migration relaxes legacy creator-token constraints without changing existing rows",async()=>{
 const {db,input}=await fixture();
 const {createArtifact}=await import("@/lib/artifacts");
 const old=await createArtifact(input.owner.tokenId,input.owner.userId,{format:"html",source:"<html><body>Legacy</body></html>",meta:{}});
 await db.query("ALTER TABLE artifacts ALTER COLUMN token_id SET NOT NULL");
 const {SCHEMA_STATEMENTS}=await import("@/lib/platform/schema");
 const relax=SCHEMA_STATEMENTS.find(sql=>/ALTER TABLE artifacts ALTER COLUMN token_id DROP NOT NULL/.test(sql));expect(relax).toBeDefined();
 await db.query(relax!);await db.query(relax!);
 expect((await db.query("SELECT token_id FROM artifacts WHERE id=$1",[old.id])).rows).toEqual([{token_id:input.owner.tokenId}]);
 const revision=structuredClone(input.revisions.at(-1)!);revision.actorTokenId=null;
 expect(await importNativeHistory(db,{...input,owner:{...input.owner,tokenId:null},revisions:[revision]})).toBe("created");
});
