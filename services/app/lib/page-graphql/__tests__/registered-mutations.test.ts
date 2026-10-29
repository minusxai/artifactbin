import { it, expect, vi, afterEach } from "vitest";
import { useAppHarness, mintAccountToken, request } from "@/__tests__/harness";
import { POST } from "@/app/api/artifacts/route";
import { requestOrSessionActor } from "@/lib/authentication";
import { getDb, services } from "@/lib/platform";
import { getArtifactById, changeMembership } from "@/lib/artifacts";
import { setDatasetPolicy } from "@/lib/document-data/dataset-policy";
import { catalogOf, loadDatasetRows } from "@/lib/datasets";
import { getHtmlBackendVersion } from "@/lib/html-backends";
import { readHtmlPage } from "@/lib/html-publication";
import {
  prepareRegisteredMutationBackend,
  commitRegisteredMutationBackend,
  registeredMutationDescriptor,
  type MutationProgram,
} from "@/lib/registered-page-mutations";
import { pageGraphql } from "../index";
import { createRetainedRegisteredMutation } from "../registered-mutations";
useAppHarness();
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const owner = await mintAccountToken("registered_dispatch_owner"),
    writer = await mintAccountToken("registered_dispatch_writer");
  const actor = await requestOrSessionActor(
      request("/api/artifacts", { token: owner.token }),
    ),
    reader = await requestOrSessionActor(
      request("/api/artifacts", { token: writer.token }),
    );
  const make = async (json: object) => {
    const reply = await POST(
      request("/api/artifacts", { method: "POST", token: owner.token, json }),
    );
    expect(reply.status).toBe(201);
    return (await reply.json()).id as string;
  };
  const datasetId = await make({
      dataset: [{ body: "seed" }],
      visibility: "private",
    }),
    pageId = await make({
      html: "<html><body>Registered action</body></html>",
      visibility: "public",
    });
  await setDatasetPolicy(
    actor,
    datasetId,
    {
      version: 2,
      allow: [{ actions: ["read", "insert"], from: { user: "$owner" } }],
    },
    0,
  );
  await changeMembership(actor, pageId, { action: "join" });
  const original = await readHtmlPage(actor, pageId),
    page = {
      ...original,
      version: original.version + 1,
      revision: String(original.version + 1),
    };
  const program: MutationProgram = {
    name: "save",
    kind: "insert",
    sql: "INSERT INTO forms.rows(body) VALUES ($body)",
    target: { datasetId, schema: "forms", table: "rows" },
    values: { body: { type: "string", nullable: false, parameter: "body" } },
    builtins: [],
    expectedAffected: 1,
    reset: ["body"],
  };
  const prepared = prepareRegisteredMutationBackend(
    "actions",
    `backend_${pageId}`,
    page,
    program,
    { compilerSha256: "a".repeat(64), sourceSha256: "b".repeat(64) },
  );
  page.links = [prepared.link];
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE artifacts SET version=$2,meta=jsonb_set(meta,'{htmlLinks}',$3::jsonb) WHERE id=$1",
      [pageId, page.version, JSON.stringify(page.links)],
    );
    await tx.query(
      "INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1",
      [pageId],
    );
    await commitRegisteredMutationBackend(tx, page, owner.userId!, prepared);
  });
  const descriptor = registeredMutationDescriptor("actions", program);
  const call = (
    token: string | undefined,
    requestId: string,
    body = "added",
    revision = page.revision,
  ) =>
    pageGraphql(
      request(`/api/artifacts/${pageId}/graphql`, {
        method: "POST",
        ...(token ? { token } : {}),
        json: {
          revision,
          query: descriptor.document,
          variables: { requestId, values: { body } },
        },
      }),
      pageId,
    );
  const rows = async () => {
    const row = (await getArtifactById(datasetId))!,
      table = catalogOf(row)!.tables[0]!;
    return loadDatasetRows({ meta: { objectKey: table.objectKey } });
  };
  return {
    owner,
    writer,
    actor,
    reader,
    pageId,
    page,
    datasetId,
    prepared,
    db,
    call,
    rows,
    descriptor,
  };
}
it("dispatches real HTTP owner writes and durable replay through the public descriptor", async () => {
  const f = await fixture();
  const response = await f.call(f.owner.token, "owner_request_1234567890");
  expect(response.status).toBe(200);
  const first = await response.json();
  expect(first.errors).toBeUndefined();
  expect(first).toMatchObject({
    data: {
      actions: {
        run: {
          requestId: "owner_request_1234567890",
          outcome: "committed",
          affected: 1,
          reset: ["body"],
        },
      },
    },
    extensions: { outcomes: { "actions.run": "committed" } },
  });
  expect(
    await (await f.call(f.owner.token, "owner_request_1234567890")).json(),
  ).toEqual(first);
  expect(await f.rows()).toEqual([{ body: "seed" }, { body: "added" }]);
  const schema = await pageGraphql(
    request(`/api/artifacts/${f.pageId}/graphql`),
    f.pageId,
  );
  expect(schema.status).toBe(200);
  expect((await schema.json()).sdl).toContain("actions__Values");
});
it("requires both accepted page membership and explicit writer grant, and denies anonymous/guest writes", async () => {
  const f = await fixture();
  await changeMembership(f.reader, f.pageId, { action: "join" });
  await changeMembership(f.actor, f.pageId, {
    action: "approve",
    userId: f.writer.userId!,
  });
  const denied = await (
    await f.call(f.writer.token, "before_grant_123456789")
  ).json();
  expect(denied.errors?.length).toBeGreaterThan(0);
  expect(await f.rows()).toHaveLength(1);
  const dataset = (await getArtifactById(f.datasetId))!;
  await setDatasetPolicy(
    f.actor,
    f.datasetId,
    {
      version: 2,
      allow: [
        { actions: ["read", "insert"], from: { user: "$owner" } },
        { actions: ["insert"], from: { user: f.writer.userId } },
      ],
    },
    dataset.policy_revision ?? 0,
  );
  const written = await (
    await f.call(f.writer.token, "after_grant_1234567890", "writer")
  ).json();
  expect(written).toMatchObject({
    data: { actions: { run: { outcome: "committed", affected: 1 } } },
  });
  expect(await f.rows()).toEqual([{ body: "seed" }, { body: "writer" }]);
  await f.db.query("UPDATE users SET kind='guest' WHERE id=$1", [
    f.writer.userId,
  ]);
  for (const token of [undefined, f.writer.token]) {
    const answer = await (
      await f.call(token, "denied_guest_1234567890", "forbidden")
    ).json();
    expect(answer.errors?.length).toBeGreaterThan(0);
  }
  expect(await f.rows()).toHaveLength(2);
});
it("returns actual HTTP403 for historical mutation without executing a resolver or creating a receipt", async () => {
  const f = await fixture(),
    runner = vi.spyOn(services().runner, "start");
  await f.db.transaction(async (tx) => {
    await tx.query(
      "UPDATE artifacts SET version=version+1,meta=jsonb_set(meta,'{htmlLinks}','[]'::jsonb) WHERE id=$1",
      [f.pageId],
    );
    await tx.query(
      "INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1",
      [f.pageId],
    );
  });
  const response = await f.call(f.owner.token, "historical_request_123456");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "archived_page_readonly" });
  expect(runner).not.toHaveBeenCalled();
  expect(await f.rows()).toHaveLength(1);
  expect(
    (await f.db.query("SELECT response FROM mutation_receipts")).rows,
  ).toHaveLength(0);
});
it("rejects unknown reserved or tampered envelopes before dispatching any ordinary runner", async () => {
  const f = await fixture(),
    runner = vi.spyOn(services().runner, "start");
  for (const compiled of [
    "!registered-page-future-v99\n{}",
    f.prepared.backend.compiled + "tampered",
  ]) {
    await f.db.query(
      "UPDATE html_backend_versions SET compiled=$3 WHERE backend_id=$1 AND version=$2",
      [f.prepared.link.backendId, f.prepared.link.version, compiled],
    );
    const response = await f.call(f.owner.token, "tamper_request_123456789");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "page_operation_unavailable",
    });
  }
  expect(runner).not.toHaveBeenCalled();
  expect(await f.rows()).toHaveLength(1);
});

it("rejects legacy token-only identities explicitly and revoked account credentials without writes", async () => {
  const f = await fixture();
  const legacy = await mintAccountToken("legacy_unattached", null);
  const resolved = await requestOrSessionActor(
    request("/api/artifacts", { token: legacy.token }),
  );
  expect(resolved.userId).toBeNull();
  expect(resolved.tokenId).toBeNull();
  const backend = (await getHtmlBackendVersion(
    f.prepared.link.backendId,
    f.prepared.link.version,
  ))!;
  const tokenActor = { ...f.actor, userId: null, tokenId: legacy.id };
  expect(() =>
    createRetainedRegisteredMutation(
      tokenActor,
      f.page,
      f.prepared.link,
      backend,
      async () => tokenActor,
    ),
  ).toThrow("registered_mutation_account_required");
  for (const token of [undefined, legacy.token]) {
    const reply = await f.call(token, "unsupported_request_123456");
    expect((await reply.json()).errors?.length).toBeGreaterThan(0);
  }
  await f.db.query("UPDATE tokens SET deleted_at=now() WHERE id=$1", [
    f.owner.id,
  ]);
  const revoked = await f.call(f.owner.token, "revoked_request_123456789");
  expect((await revoked.json()).errors?.length).toBeGreaterThan(0);
  expect(await f.rows()).toEqual([{ body: "seed" }]);
  expect(
    (await f.db.query("SELECT response FROM mutation_receipts")).rows,
  ).toHaveLength(0);
});

it("refuses a credential that expired while the commit transaction ran, reading the wall clock at the fence", async () => {
  const f = await fixture();
  const original = f.db.transaction.bind(f.db);
  let expired = false;
  // Expire the owner's token after the commit has taken its row locks, before the registered page's fence runs.
  vi.spyOn(f.db, "transaction").mockImplementation((fn) =>
    original((tx) =>
      fn({
        ...tx,
        query: async (sql: string, values?: unknown[]) => {
          const result = await tx.query(sql, values);
          if (!expired && /FROM artifacts WHERE id=ANY\(\$1::text\[\]\) ORDER BY id FOR UPDATE/.test(sql)) {
            expired = true;
            await tx.query("SELECT pg_sleep(0.02)");
            await tx.query("UPDATE tokens SET expires_at = now() + (clock_timestamp() - now()) / 2 WHERE id = $1", [f.owner.id]);
          }
          return result as never;
        },
      } as typeof tx),
    ),
  );
  const reply = await f.call(f.owner.token, "expiring_request_123456789");
  expect(expired).toBe(true);
  expect((await reply.json()).data?.actions?.run?.outcome).not.toBe("committed");
  expect(await f.rows()).toEqual([{ body: "seed" }]);
});
