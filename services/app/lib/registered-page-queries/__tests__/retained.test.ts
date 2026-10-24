import { serveSql, sqlClient } from "@artifactbin/sql";
import { createSql } from "@artifactbin/sql/local";
import { services, setServices } from "@/lib/platform/services";
import { overrideConfig, resetConfigOverrides } from "@/lib/platform/config";
import { objectStore, objectKey } from "@/lib/object-store";
import { catalogOf } from "@/lib/datasets/catalog";
import { createRetainedRegisteredQueries } from "../retained";
import { registeredPlan } from "../registry";
import { getHtmlBackendVersion } from "@/lib/html-backends";
import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken, request } from "@/__tests__/harness";
import { POST } from "@/app/api/artifacts/route";
import { getDb } from "@/lib/platform";
import { readHtmlPage } from "@/lib/html-publication";
import { ANONYMOUS_ACTOR, requestOrSessionActor } from "@/lib/accounts";
import { getArtifactById, canReadArtifact } from "@/lib/artifacts";
import { pageGraphql } from "@/lib/page-graphql";
import {
  prepareRegisteredQueryBackend,
  commitRegisteredQueryBackend,
} from "../registry";
useAppHarness();
it("persists immutable query registration atomically and serves anonymous result-only reads of private owner sources", async () => {
  let spinAdmitted!: () => void,
    spinReleased = false,
    ownedSourceWindows = 0;
  const admitted = new Promise<void>((resolve) => {
    spinAdmitted = resolve;
  });
  const previousSql = services().sql,
    pool = createSql({ timeoutMs: 1000 }, { workers: 1 }),
    server = serveSql({
      ...pool,
      startRead: (input) => {
        const handle = pool.startRead!(input);
        if (input.catalog) ownedSourceWindows++;
        if (input.queries.some((query) => query.name === "spin")) {
          handle.result.then(() => {
            spinReleased = true;
          });
          spinAdmitted();
        }
        return handle;
      },
    }),
    remote = server.listen(0);
  overrideConfig({ sqlServiceUrl: remote.url });
  setServices({ sql: sqlClient(remote.url) });
  try {
    const owner = await mintAccountToken("registered_query_fixture");
    const actor = await requestOrSessionActor(
      request("/api/artifacts", { token: owner.token }),
    );
    const datasetResponse = await POST(
      request("/api/artifacts", {
        method: "POST",
        token: owner.token,
        json: {
          dataset: [{ amount: 2 }, { amount: 4 }],
          visibility: "private",
        },
      }),
    );
    expect(datasetResponse.status).toBe(201);
    const dataset = await datasetResponse.json();
    // A retained dataset without v2 read grants uses document reach for query results.
    // Explicit v2 audience ceilings remain enforced by the original resolver.
    const originalPolicy = (await getArtifactById(dataset.id))!.dataset_policy;
    await (
      await getDb()
    ).query("UPDATE artifacts SET dataset_policy=NULL WHERE id=$1", [
      dataset.id,
    ]);
    const response = await POST(
      request("/api/artifacts", {
        method: "POST",
        token: owner.token,
        json: {
          html: "<html><body><p>Public aggregate</p></body></html>",
          visibility: "public",
        },
      }),
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    const original = await readHtmlPage(actor, created.id),
      page = {
        ...original,
        version: original.version + 1,
        revision: String(original.version + 1),
      };
    const registration = prepareRegisteredQueryBackend(
      "queries",
      "registered_fixture_backend",
      page,
      {
        scalars: { minimum: { type: "number", default: null } },
        queries: [
          {
            name: "spin",
            sql: "with recursive c(n) as (select 1 union all select n+1 from c) select count(*) as n from c",
            dependencies: [],
          },
          {
            name: "total",
            sql: "select sum(amount) as amount from items.rows where $minimum is null or amount >= $minimum",
            dependencies: [],
          },
        ],
        imports: [{ alias: "items", binding: dataset.id, table: "rows" }],
      },
      {
        compilerSha256: "a".repeat(64),
        sourceSha256: "b".repeat(64),
        sqlEngineSha256: "c".repeat(64),
      },
    );
    page.links = [registration.link];
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE artifacts SET version=$2,meta=jsonb_set(meta,'{htmlLinks}',$3::jsonb) WHERE id=$1",
        [page.pageId, page.version, JSON.stringify(page.links)],
      );
      await tx.query(
        "INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1",
        [page.pageId],
      );
      await commitRegisteredQueryBackend(tx, page, owner.userId!, registration);
    });
    expect(
      await canReadArtifact(
        (await getArtifactById(dataset.id))!,
        ANONYMOUS_ACTOR,
      ),
    ).toBe(false);
    const persisted = (await getHtmlBackendVersion(
      registration.link.backendId,
      registration.link.version,
    ))!;
    const plan = registeredPlan(page, registration.link, persisted)!;
    await createRetainedRegisteredQueries(ANONYMOUS_ACTOR, page).execute(
      { ...plan.registration, subject: null },
      { values: { minimum: null }, only: ["total"] },
      new AbortController().signal,
    );
    const run = () =>
      pageGraphql(
        request(`/api/artifacts/${page.pageId}/graphql`, {
          method: "POST",
          json: {
            revision: page.revision,
            query:
              "query {queries {evaluate(values:{minimum:null},only:[total]) {tables {name error rows {cells {number isNull}}}}}}",
          },
        }),
        page.pageId,
      );
    const result = await run();
    expect(result.status).toBe(200);
    const answer = await result.json();
    expect(answer.errors).toBeUndefined();
    expect(answer.data).toMatchObject({
      queries: {
        evaluate: {
          tables: [
            {
              name: "total",
              rows: [{ cells: [{ number: 6, isNull: false }] }],
            },
          ],
        },
      },
    });
    // Archived page bindings intentionally continue reading the current dataset.
    const source = (await getArtifactById(dataset.id))!,
      catalog = catalogOf(source)!;
    const bytes = JSON.stringify([{ amount: 5 }, { amount: 6 }]),
      key = objectKey("dataset", bytes);
    await objectStore().put(key, bytes);
    const metadata = {
      ...source.meta,
      objectKey: key,
      catalog: {
        ...catalog,
        tables: catalog.tables.map((table) => ({ ...table, objectKey: key })),
      },
    };
    await db.query(
      "UPDATE artifacts SET version=version+1,meta=$2::jsonb WHERE id=$1",
      [dataset.id, JSON.stringify(metadata)],
    );
    // The page itself now has a newer head; saved revision 2 must still read current data.
    await db.query(
      "UPDATE artifacts SET version=version+1,meta=jsonb_set(meta,'{htmlLinks}','[]'::jsonb) WHERE id=$1",
      [page.pageId],
    );
    await db.query(
      "INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1",
      [page.pageId],
    );
    const current = await run();
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      data: {
        queries: {
          evaluate: { tables: [{ rows: [{ cells: [{ number: 11 }] }] }] },
        },
      },
    });
    // A computed public table must retain its stored base relation in the execution catalog.
    await db.query("UPDATE artifacts SET version=version+1,meta=$2::jsonb WHERE id=$1", [dataset.id, JSON.stringify({...metadata,catalog:{...catalog,tables:[{...catalog.tables[0]!,name:'base',objectKey:key},{schema:'public',name:'rows',columns:catalog.tables[0]!.columns,sql:'select amount*2 as amount from base'}]}})]);
    expect(await (await run()).json()).toMatchObject({data:{queries:{evaluate:{tables:[{rows:[{cells:[{number:22}]}]}]}}}});
    expect(ownedSourceWindows).toBeGreaterThan(0);
    const cancellation = new AbortController();
    const spinning = createRetainedRegisteredQueries(
      ANONYMOUS_ACTOR,
      page,
    ).execute(
      { ...plan.registration, subject: null },
      { values: { minimum: null }, only: ["spin"] },
      cancellation.signal,
    );
    await admitted;
    cancellation.abort(Error("stop_registered_read"));
    await expect(spinning).rejects.toThrow("stop_registered_read");
    expect(spinReleased).toBe(true);
    // Connected models execute once, then serve coherent bounded windows of that result.
    const connected={kind:'postgres' as const,defaultSchema:'public',refreshSeconds:0,connection:{host:'database.invalid',port:5432,database:'fixture',username:'reader',ssl:true,passwordSecretId:'sec_fixture'},notebook:{cells:[{id:'model',name:'model',sql:'select amount from source'}]},tables:[{schema:'public',name:'rows',columns:[{name:'amount',type:'number' as const}],modelCellId:'model'}]};
    await db.query("UPDATE artifacts SET version=version+1,meta=$2::jsonb WHERE id=$1",[dataset.id,JSON.stringify({...metadata,catalog:connected})]);
    let connectedReads=0,credentialRotated=false;
    const connectedRun=(truncated=false,rotate=false)=>createRetainedRegisteredQueries(ANONYMOUS_ACTOR,page,{
      sourceStats:async()=>{throw Error('connected_source_is_not_an_object');},
      resolveConnection:async()=>({host:'database.invalid',port:5432,database:'fixture',username:'reader',ssl:true,password:credentialRotated?'rotated-password':'fixture-password'}),
      readWindow:async(saved,_sql,_params,options)=>{
        connectedReads++;expect(saved).toEqual(connected);expect(options).toMatchObject({datasetId:dataset.id,limit:10000,offset:0});await options?.authorize?.();credentialRotated=rotate;
        return {columns:connected.tables[0]!.columns,rows:Array.from({length:501},()=>({amount:1})),truncated,refreshedAt:new Date().toISOString()};
      },
    }).execute({...plan.registration,subject:null},{values:{minimum:null},only:['total']},new AbortController().signal);
    expect(await connectedRun()).toMatchObject({total:{rows:[{amount:501}]}});
    expect(connectedReads).toBe(1);
    await expect(connectedRun(true)).rejects.toThrow('query_input_limit');
    await expect(connectedRun(false,true)).rejects.toThrow('dataset_changed');
    // Restoring the current v2 private read audience must deny the same anonymous result.
    await db.query(
      "UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1",
      [dataset.id, JSON.stringify(originalPolicy)],
    );
    expect((await (await run()).json()).errors?.length).toBeGreaterThan(0);
    // No mutation root is exported, including for a signed-out viewer.
    const mutation = await pageGraphql(
      request(`/api/artifacts/${page.pageId}/graphql`, {
        method: "POST",
        json: {
          revision: page.revision,
          query:
            "mutation {queries {evaluate(values:{minimum:null},only:[total]) {tables {name}}}}",
        },
      }),
      page.pageId,
    );
    expect(mutation.status).toBe(403);
    expect(await mutation.json()).toMatchObject({
      error: "archived_page_readonly",
    });
  } finally {
    resetConfigOverrides();
    setServices({ sql: previousSql });
    await server.close();
    await pool.close();
  }
});
