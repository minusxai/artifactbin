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
  const owner = await mintAccountToken("registered_query_fixture");
  const actor = await requestOrSessionActor(
    request("/api/artifacts", { token: owner.token }),
  );
  const datasetResponse = await POST(
    request("/api/artifacts", {
      method: "POST",
      token: owner.token,
      json: { dataset: [{ amount: 2 }, { amount: 4 }], visibility: "private" },
    }),
  );
  expect(datasetResponse.status).toBe(201);
  const dataset = await datasetResponse.json();
  // A retained dataset without v2 read grants uses document reach for query results.
  // Explicit v2 audience ceilings remain enforced by the original resolver.
  const originalPolicy = (await getArtifactById(dataset.id))!.dataset_policy;
  await (
    await getDb()
  ).query("UPDATE artifacts SET dataset_policy=NULL WHERE id=$1", [dataset.id]);
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
          { name: "total", rows: [{ cells: [{ number: 6, isNull: false }] }] },
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
  // Restoring the current v2 private read audience must deny the same anonymous result.
  await db.query("UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1", [
    dataset.id,
    JSON.stringify(originalPolicy),
  ]);
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
});
