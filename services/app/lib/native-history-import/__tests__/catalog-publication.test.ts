import { it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteSql } from "@artifactbin/sql/sqlite";
import { useAppHarness, mintAccountToken } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import { ANONYMOUS_ACTOR, identityForUser } from "@/lib/accounts";
import { canonicalizeHtmlPage } from "@/lib/html-page";
import { getArtifactById, canReadArtifact } from "@/lib/artifacts";
import { executeCatalog } from "@/lib/datasets/execute";
import { createRetainedRegisteredQueries } from "@/lib/registered-page-queries/retained";
import { prepareRegisteredQueryBackend } from "@/lib/registered-page-queries/registry";
import { importNativeHistory } from "../index";
import { nativeCatalogDatasetIdentity } from "../catalog-publication";
import { stageNativeCatalog } from "../catalog-objects";
import { createNativeLocalObjectSink } from "../catalog-staging";
import { nativeCatalogBytes, nativeCatalogDigest } from "../catalog-digest";
import type {
  NativeCatalogProjection,
  NativeCatalogVersion,
} from "../catalog-contracts";
import type { NativeHistoryImport } from "../contracts";
useAppHarness();
async function fixture(twoTables = false) {
  const owner = await mintAccountToken("synthetic_catalog_owner"),
    viewer = await mintAccountToken("synthetic_catalog_viewer"),
    root = await mkdtemp(path.join(tmpdir(), "native-catalog-publication-")),
    sink = await createNativeLocalObjectSink(root),
    dataId = "CatalogData",
    pageId = "CatalogPage",
    t0 = "2020-01-01T00:00:00.000Z",
    t1 = "2020-01-03T00:00:00.000Z",
    columns = [
      { name: "owner", type: "string" },
      { name: "amount", type: "number" },
    ];
  const old = Buffer.from(JSON.stringify([{ owner: owner.userId, amount: 1 }])),
    current = Buffer.from(
      JSON.stringify([
        { owner: owner.userId, amount: 2 },
        { owner: viewer.userId, amount: 4 },
      ]),
    ),
    objects = [old, current].map((bytes) => ({
      objectKey: "dataset/" + nativeCatalogBytes(bytes).slice(0, 32),
      targetKey: "dataset/" + nativeCatalogBytes(bytes).slice(0, 32),
      status: "copied" as const,
      sha256: nativeCatalogBytes(bytes),
      bytes: bytes.length,
    })),
    blobs = new Map(objects.map((o, i) => [o.objectKey, [old, current][i]!]));
  const metadata = (index: number) => ({
    catalog: {
      kind: "stored",
      defaultSchema: "public",
      refreshSeconds: 0,
      tables: (twoTables ? ["rows", "members"] : ["rows"]).map(name => ({schema:"public",name,columns,objectKey:objects[index]!.objectKey})),
    },
    columns,
    objectKey: objects[index]!.objectKey,
  });
  const policy = {
      version: 2,
      allow: [{ actions: ["read"], from: { user: "*", artifact: pageId } }],
    },
    rawHead = {
      id: dataId,
      edit_id: "synthetic-catalog-edit",
      version: 3,
      format: "dataset",
      source: '<Dataset kind="stored" />',
      meta: metadata(1),
      title: "Synthetic data",
      description: null,
      token_id: owner.id,
      user_id: owner.userId,
      group_id: null,
      creator_user_id: owner.userId,
      actor_user_id: owner.userId,
      actor_token_id: owner.id,
      visibility: "unlisted",
      link_role: "viewer",
      access: "readwrite",
      dataset_policy: policy,
      sharing_revision: 0,
      policy_revision: 2,
      ancestor_ids: [],
      created_at: t0,
      updated_at: t1,
      deleted_at: null,
    },
    rawOld = {
      artifact_id: dataId,
      version: 1,
      format: "dataset",
      source: '<Dataset kind="stored" />',
      meta: metadata(0),
      title: "Earlier data",
      description: null,
      actor_user_id: owner.userId,
      actor_token_id: owner.id,
      created_at: t0,
    },
    rawBytes = Buffer.from(
      JSON.stringify({ heads: [rawHead], versions: [rawOld] }),
    );
  const relationBytes = Buffer.from(
    JSON.stringify({
      heads: [{ id: dataId, version: 3, updated_at: t1 }],
      artifact_shares: [],
      dataset_policy_audit: [
        {
          dataset_id: dataId,
          revision: 2,
          policy,
          actor_user_id: owner.userId,
          actor_token_id: owner.id,
          created_at: t1,
        },
      ],
    }),
  );
  const versions: NativeCatalogVersion[] = [rawOld, rawHead].map((row) => ({
    version: row.version,
    sourceSha256: nativeCatalogDigest(row),
    source: row.source,
    meta: row.meta,
    title: row.title,
    description: row.description,
    createdAt: row === rawHead ? t1 : t0,
    actorUserId: owner.userId,
    actorTokenId: owner.id,
  }));
  const canonical = canonicalizeHtmlPage(
      '<html><body><p data-af-id="stable">Viewer result</p></body></html>',
    ),
    page = {
      pageId,
      version: 1,
      revision: "1",
      html: canonical.html,
      nextNodeId: canonical.ledger.nextNodeId,
      links: [] as NativeHistoryImport["revisions"][number]["page"]["links"],
    };
  const prepared = prepareRegisteredQueryBackend(
    "queries",
    "catalog_fixture_backend",
    page,
    {
      scalars: {},
      queries: [
        {
          name: "visible",
          sql: "SELECT owner, amount FROM items.rows WHERE owner = (SELECT id FROM _me)",
          dependencies: [],
        },
      ],
      imports: (twoTables ? ["rows", "members"] : ["rows"]).map(table => ({alias:"items",binding:dataId,table})),
    },
    {
      compilerSha256: "a".repeat(64),
      sourceSha256: "b".repeat(64),
      sqlEngineSha256: "c".repeat(64),
    },
  );
  page.links = [prepared.link];
  const payload = {
    sourceNamespace: "synthetic-canonical",
    selectionSha256: "a".repeat(64),
    sourceManifestSha256: "b".repeat(64),
    objectManifestSha256: nativeCatalogBytes(JSON.stringify(objects)),
    identities: {
      users: {
        [owner.userId!]: owner.userId!,
        [viewer.userId!]: viewer.userId!,
      },
      tokens: { [owner.id]: owner.id },
      groups: {},
      artifacts: { [dataId]: dataId, [pageId]: pageId },
    },
    imports: (twoTables ? ["rows", "members"] : ["rows"]).map(table => ({
        pageId,
        pageVersion: 1,
        backendId: prepared.link.backendId,
        backendVersion: prepared.link.version,
        alias: "items",
        datasetId: dataId,
        table,
      })),
    objects,
    datasets: [
      {
        sourceId: dataId,
        targetId: dataId,
        sourceSha256: nativeCatalogBytes(rawBytes),
        relationsSha256: nativeCatalogBytes(relationBytes),
        policyAudit: [
          {
            revision: 2,
            policy,
            actorUserId: owner.userId,
            actorTokenId: owner.id,
            createdAt: t1,
          },
        ],
        currentVersion: 3,
        expectedVersions: [1, 3],
        versions,
        authority: {
          tokenId: owner.id,
          userId: owner.userId,
          groupId: null,
          creatorUserId: owner.userId,
          ancestorIds: [],
          visibility: "unlisted" as const,
          linkRole: "viewer" as const,
          access: "readwrite" as const,
          datasetPolicy: policy,
          sharingRevision: 0,
          policyRevision: 2,
          editId: "synthetic-catalog-edit",
          createdAt: t0,
          updatedAt: t1,
          deletedAt: null,
          shares: [],
        },
      },
    ],
  };
  const projection: NativeCatalogProjection = {
      ...payload,
      sha256: nativeCatalogDigest(payload),
    },
    source = {
      objectManifestSha256: projection.objectManifestSha256,
      read: async (object: { objectKey: string }) =>
        blobs.get(object.objectKey)!,
      dataset: async () => rawBytes,
      relations: async () => relationBytes,
    },
    staged = await stageNativeCatalog(projection, source, sink),
    history: NativeHistoryImport = {
      sourceNamespace: "synthetic-canonical",
      sourceId: "old-page",
      selectionSha256: projection.selectionSha256,
      projectionSha256: "e".repeat(64),
      relationSha256: staged.sourceSha256,
      pageId,
      owner: { userId: owner.userId!, tokenId: owner.id },
      visibility: "public",
      linkRole: "viewer",
      shares: [],
      headVersion: 1,
      revisions: [
        {
          page,
          ledger: canonical.ledger,
          sourceSha256: nativeCatalogBytes(page.html),
          title: "Viewer result",
          description: null,
          createdAt: t0,
          actorUserId: owner.userId,
          actorTokenId: owner.id,
          queries: [prepared],
          mutations: [],
        },
      ],
    };
  return {
    owner,
    viewer,
    root,
    sink,
    dataId,
    page,
    prepared,
    projection,
    source,
    staged,
    history,
  };
}
it("publishes exact sparse catalogs atomically and real retained queries preserve viewer filters and live current datasets", async () => {
  const f = await fixture(),
    db = await getDb();
  try {
    expect(await importNativeHistory(db, f.history, f.staged)).toBe("created");
    expect(await importNativeHistory(db, f.history, f.staged)).toBe(
      "unchanged",
    );
    expect(
      (
        await db.query(
          "SELECT version FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",
          [f.dataId],
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 3 }]);
    expect(
      await canReadArtifact(
        (await getArtifactById(f.dataId))!,
        ANONYMOUS_ACTOR,
      ),
    ).toBe(false);
    const sql = createSqliteSql();
    // Host context is the exact saved immutable registration; actor never comes from page parameters.
    const read = async (actor: ReturnType<typeof identityForUser>) => {
      const retained = createRetainedRegisteredQueries(actor, f.page, {
        execute: (input) => sql.run(input),
        sourceStats: async (key) => {
          const bytes = await f.sink.get(key);
          return {
            rows: JSON.parse(bytes.toString()).length,
            bytes: bytes.length,
          };
        },
        readWindow: (catalog, statement, values, options) =>
          executeCatalog(catalog, statement, values, {
            ...options,
            objects: f.sink,
            execute: (input) => sql.run(input),
          }),
      });
      return retained.execute(
        {
          pageId: f.page.pageId,
          pageVersion: 1,
          backendId: f.prepared.link.backendId,
          backendVersion: f.prepared.link.version,
          sourceSha256: nativeCatalogBytes(f.page.html),
          subject: actor.userId,
        },
        { values: {}, only: ["visible"] },
        new AbortController().signal,
      );
    };
    expect(
      await read(identityForUser(f.owner.userId, f.owner.id)),
    ).toMatchObject({
      visible: { rows: [{ owner: f.owner.userId, amount: 2 }] },
    });
    expect(
      await read(identityForUser(f.viewer.userId, f.viewer.id)),
    ).toMatchObject({
      visible: { rows: [{ owner: f.viewer.userId, amount: 4 }] },
    });
    expect(await read(ANONYMOUS_ACTOR)).toMatchObject({
      visible: { rows: [] },
    });
    const bytes = Buffer.from(
        JSON.stringify([{ owner: f.owner.userId, amount: 9 }]),
      ),
      key = "dataset/" + nativeCatalogBytes(bytes).slice(0, 32);
    await f.sink.putIfAbsent(key, bytes);
    const row = (await getArtifactById(f.dataId))!,
      meta = structuredClone(row.meta) as any;
    meta.catalog.tables[0].objectKey = key;
    meta.objectKey = key;
    await db.query(
      "UPDATE artifacts SET version=4,meta=$2::jsonb WHERE id=$1",
      [f.dataId, JSON.stringify(meta)],
    );
    expect(
      await read(identityForUser(f.owner.userId, f.owner.id)),
    ).toMatchObject({ visible: { rows: [{ amount: 9 }] } });
    await expect(importNativeHistory(db, f.history, f.staged)).rejects.toThrow(
      /catalog/,
    );
    expect((await getArtifactById(f.dataId))!.version).toBe(4);
    await db.query(
      "UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1",
      [f.dataId, JSON.stringify({ version: 2, allow: [] })],
    );
    await expect(
      read(identityForUser(f.viewer.userId, f.viewer.id)),
    ).rejects.toThrow(/unavailable|denied/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it("admits only exact current dataset state from complete canonical receipts in explicit latest mode", async () => {
  const f=await fixture(),db=await getDb();
  try {
    const projection=structuredClone(f.projection);projection.revisionScope="latest";
    const dataset=projection.datasets[0]!;
    dataset.versions=dataset.versions.filter(version=>version.version===dataset.currentVersion);
    dataset.expectedVersions=[dataset.currentVersion];
    projection.objects=[projection.objects[1]!];
    const raw=JSON.parse((await f.source.dataset()).toString());
    raw.versions[0].actor_user_id="unselected_old_actor";
    const rawBytes=Buffer.from(JSON.stringify(raw));dataset.sourceSha256=nativeCatalogBytes(rawBytes);
    const relations=JSON.parse((await f.source.relations()).toString());
    relations.dataset_policy_audit.push({...relations.dataset_policy_audit[0],revision:1,actor_user_id:"unselected_old_actor",actor_token_id:"unselected_old_token"});
    const relationBytes=Buffer.from(JSON.stringify(relations));dataset.relationsSha256=nativeCatalogBytes(relationBytes);
    const {sha256,...payload}=projection;projection.sha256=nativeCatalogDigest(payload);
    const stagedKeys:string[]=[],stored=new Map<string,Buffer>();
    const staged=await stageNativeCatalog(projection,{...f.source,dataset:async()=>rawBytes,relations:async()=>relationBytes,read:async object=>{
      expect(object.objectKey).toBe(projection.objects[0]!.objectKey);return f.source.read(object);
    }},{get:async key=>stored.get(key)!,putIfAbsent:async(key,bytes)=>{stagedKeys.push(key);stored.set(key,bytes);return "created";}});
    const history={...f.history,relationSha256:staged.sourceSha256};
    expect(await importNativeHistory(db,history,staged)).toBe("created");
    expect(await importNativeHistory(db,history,staged)).toBe("unchanged");
    expect((await db.query("SELECT version FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",[f.dataId])).rows).toEqual([{version:3}]);
    expect(stagedKeys).toEqual([projection.objects[0]!.targetKey]);
    const saved=(await getArtifactById(f.dataId))!;
    expect(saved).toMatchObject({version:3,visibility:dataset.authority.visibility,link_role:dataset.authority.linkRole,access:dataset.authority.access,dataset_policy:dataset.authority.datasetPolicy});
    expect((await db.query("SELECT revision FROM dataset_policy_audit WHERE dataset_id=$1",[f.dataId])).rows).toEqual([{revision:2}]);
  } finally {await rm(f.root,{recursive:true,force:true});}
});

it("latest dataset admission refuses projected history, omitted current audit and changed head metadata", async()=>{
 const f=await fixture();try{
  for(const mutate of [()=>{},(p:NativeCatalogProjection)=>{const d=p.datasets[0]!;d.expectedVersions=[3];d.versions=d.versions.filter(v=>v.version===3);d.policyAudit=[];},(p:NativeCatalogProjection)=>{const d=p.datasets[0]!;d.expectedVersions=[3];d.versions=d.versions.filter(v=>v.version===3);d.versions[0]!.title="changed";}]){
   const p=structuredClone(f.projection);p.revisionScope="latest";mutate(p);const {sha256,...payload}=p;p.sha256=nativeCatalogDigest(payload);
   await expect(stageNativeCatalog(p,f.source,f.sink)).rejects.toThrow(/native_catalog/);
  }
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it("late verification failure rolls back page, dataset, registry and catalogs while immutable staging remains independent", async () => {
  const f = await fixture(),
    db = await getDb();
  try {
    await expect(
      importNativeHistory(db, f.history, {
        sourceSha256: f.staged.sourceSha256,
        apply: f.staged.apply,
        verify: async (tx, id) => {
          await f.staged.verify(tx, id);
          throw Error("late check");
        },
      }),
    ).rejects.toThrow("late check");
    expect(
      (
        await db.query("SELECT id FROM artifacts WHERE id=ANY($1::text[])", [
          [f.dataId, f.page.pageId],
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "SELECT id FROM artifact_id_registry WHERE id=ANY($1::text[])",
          [[f.dataId, f.page.pageId]],
        )
      ).rows,
    ).toEqual([]);
    expect(await f.sink.get(f.projection.objects[0]!.targetKey)).toBeInstanceOf(
      Buffer,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("missing historical objects, sparse-label omission and canonical metadata tampering never become empty datasets", async () => {
  const f = await fixture();
  try {
    for (const change of [
      (p: NativeCatalogProjection) => {
        p.objects = p.objects.slice(1);
      },
      (p: NativeCatalogProjection) => {
        p.datasets[0]!.versions = p.datasets[0]!.versions.slice(1);
      },
      (p: NativeCatalogProjection) => {
        p.datasets[0]!.versions[0]!.meta.columns = [];
      },
    ]) {
      const p = structuredClone(f.projection);
      change(p);
      const { sha256, ...payload } = p;
      p.sha256 = nativeCatalogDigest(payload);
      await expect(stageNativeCatalog(p, f.source, f.sink)).rejects.toThrow(
        /catalog/,
      );
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("rejects a mismatched registered import atomically instead of granting an undeclared dataset", async () => {
  const f = await fixture(),
    db = await getDb();
  try {
    const p = structuredClone(f.projection);
    p.imports[0]!.table = "other";
    const { sha256, ...payload } = p;
    p.sha256 = nativeCatalogDigest(payload);
    const staged = await stageNativeCatalog(p, f.source, f.sink);
    f.history.relationSha256 = staged.sourceSha256;
    await expect(importNativeHistory(db, f.history, staged)).rejects.toThrow(
      /import_registration/,
    );
    expect(
      (
        await db.query("SELECT id FROM artifacts WHERE id=ANY($1::text[])", [
          [f.dataId, f.page.pageId],
        ])
      ).rows,
    ).toEqual([]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("requires digest-bound canonical share closure and the matching collected dataset head", async () => {
  const f = await fixture();
  try {
    const p = structuredClone(f.projection);
    p.datasets[0]!.authority.shares = [
      { email: "viewer@example.test", role: "viewer" },
    ];
    const { sha256, ...payload } = p;
    p.sha256 = nativeCatalogDigest(payload);
    await expect(stageNativeCatalog(p, f.source, f.sink)).rejects.toThrow(
      /source_shares/,
    );
    await expect(
      stageNativeCatalog(
        f.projection,
        { ...f.source, relations: undefined },
        f.sink,
      ),
    ).rejects.toThrow(/relations_required/);
    await expect(
      stageNativeCatalog(
        f.projection,
        { ...f.source, relations: async () => Buffer.from("{}") },
        f.sink,
      ),
    ).rejects.toThrow(/relations_digest/);
    const staleBytes = Buffer.from(
        JSON.stringify({
          heads: [
            { id: f.dataId, version: 2, updated_at: "2020-01-01T00:00:00Z" },
          ],
          artifact_shares: [],
        }),
      ),
      stale = structuredClone(f.projection);
    stale.datasets[0]!.relationsSha256 = nativeCatalogBytes(staleBytes);
    const { sha256: old, ...stalePayload } = stale;
    stale.sha256 = nativeCatalogDigest(stalePayload);
    await expect(
      stageNativeCatalog(
        stale,
        { ...f.source, relations: async () => staleBytes },
        f.sink,
      ),
    ).rejects.toThrow(/relations_head/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("preserves exact source policy audit and rejects omitted history or replay tampering", async () => {
  const f = await fixture(),
    db = await getDb();
  try {
    const p = structuredClone(f.projection);
    p.datasets[0]!.policyAudit = [];
    const { sha256, ...payload } = p;
    p.sha256 = nativeCatalogDigest(payload);
    await expect(stageNativeCatalog(p, f.source, f.sink)).rejects.toThrow(
      /source_audit/,
    );
    await importNativeHistory(db, f.history, f.staged);
    const audit = (
      await db.query(
        "SELECT revision,policy,actor_user_id,actor_token_id,created_at FROM dataset_policy_audit WHERE dataset_id=$1",
        [f.dataId],
      )
    ).rows;
    expect(audit).toMatchObject([
      {
        revision: 2,
        policy: f.projection.datasets[0]!.authority.datasetPolicy,
        actor_user_id: f.owner.userId,
        actor_token_id: f.owner.id,
      },
    ]);
    await db.query(
      "UPDATE dataset_policy_audit SET policy=NULL WHERE dataset_id=$1",
      [f.dataId],
    );
    await expect(importNativeHistory(db, f.history, f.staged)).rejects.toThrow(
      /policy_audit_collision/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it("two pages reuse the same exact dataset across distinct import aliases and reachable projections", async()=>{
 const f=await fixture(),db=await getDb(),counts:Record<string,{datasetSelects:number;catalogLocks:number}>={};let phase="first";
 const measured={transaction:<T>(work:(tx:import("@/lib/platform/db").Queryable)=>Promise<T>)=>db.transaction(tx=>work({query:async<T>(sql:string,values:unknown[]=[])=>{const count=counts[phase]??={datasetSelects:0,catalogLocks:0};if(values[0]===f.dataId){if(sql.startsWith("SELECT")&&sql.includes("FROM "))count.datasetSelects++;if(sql.includes("native-catalog:"))count.catalogLocks++;}return tx.query<T>(sql,values);}}))};
 try{
  expect(await importNativeHistory(measured,f.history,f.staged)).toBe("created");
  const page={...structuredClone(f.page),pageId:"CatalogOtherPage",links:[] as typeof f.page.links};
  const prepared=prepareRegisteredQueryBackend("queries","catalog_second_backend",page,{scalars:{},queries:[{name:"visible",sql:"SELECT owner, amount FROM records.rows WHERE owner = (SELECT id FROM _me)",dependencies:[]}],imports:[{alias:"records",binding:f.dataId,table:"rows"}]},{compilerSha256:"a".repeat(64),sourceSha256:"b".repeat(64),sqlEngineSha256:"c".repeat(64)});page.links=[prepared.link];
  const projection=structuredClone(f.projection);projection.imports=[{pageId:page.pageId,pageVersion:1,backendId:prepared.link.backendId,backendVersion:prepared.link.version,alias:"records",datasetId:f.dataId,table:"rows"}];const{sha256,...payload}=projection;projection.sha256=nativeCatalogDigest(payload);
  expect(projection.sha256).not.toBe(f.projection.sha256);
  const staged=await stageNativeCatalog(projection,f.source,f.sink),history={...structuredClone(f.history),sourceId:"other-page",pageId:page.pageId,projectionSha256:"f".repeat(64),relationSha256:staged.sourceSha256};history.revisions[0]!.page=page;history.revisions[0]!.queries=[prepared];
  phase="second";expect(await importNativeHistory(measured,history,staged)).toBe("created");phase="replay";expect(await importNativeHistory(measured,history,staged)).toBe("unchanged");
  expect(counts).toEqual({first:{datasetSelects:11,catalogLocks:1},second:{datasetSelects:11,catalogLocks:1},replay:{datasetSelects:5,catalogLocks:0}});
  const originalIdentity=nativeCatalogDatasetIdentity(f.projection,f.projection.datasets[0]!,f.projection.datasets[0]!.versions[0]!);
  expect(nativeCatalogDatasetIdentity({...projection,datasets:[...projection.datasets,{...projection.datasets[0]!,sourceId:"unrelated",targetId:"UnrelatedData"}]},projection.datasets[0]!,projection.datasets[0]!.versions[0]!)).toEqual(originalIdentity);
  await db.query("UPDATE artifacts SET title='divergent' WHERE id=$1",[f.dataId]);await expect(importNativeHistory(db,history,staged)).rejects.toThrow("native_catalog_collision");
  await writeFile(path.join(f.root,projection.objects[1]!.targetKey),Buffer.from("[]"));
  await expect(stageNativeCatalog(projection,f.source,f.sink)).rejects.toThrow(/native_catalog_object/);

 }finally{await rm(f.root,{recursive:true,force:true});}
});

it("imports and replays two declared tables under the same dataset alias",async()=>{const f=await fixture(true),db=await getDb();try{expect(await importNativeHistory(db,f.history,f.staged)).toBe("created");expect(await importNativeHistory(db,f.history,f.staged)).toBe("unchanged");expect((await db.query("SELECT id FROM artifacts WHERE id=ANY($1::text[])",[[f.dataId,f.page.pageId]])).rows).toHaveLength(2);}finally{await rm(f.root,{recursive:true,force:true});}});
it.each(["duplicate-pair","mismatched-binding"])("rejects %s in multi-table registration atomically",async(kind)=>{const f=await fixture(true),db=await getDb();try{const projection=structuredClone(f.projection);if(kind==="duplicate-pair")Object.assign(projection.imports[1]!,projection.imports[0]!);else projection.imports[1]!.table="undeclared";const {sha256,...body}=projection;projection.sha256=nativeCatalogDigest(body);const staged=await stageNativeCatalog(projection,f.source,f.sink);f.history.relationSha256=staged.sourceSha256;await expect(importNativeHistory(db,f.history,staged)).rejects.toThrow(/import_registration/);expect((await db.query("SELECT id FROM artifacts WHERE id=ANY($1::text[])",[[f.dataId,f.page.pageId]])).rows).toEqual([]);}finally{await rm(f.root,{recursive:true,force:true});}});
