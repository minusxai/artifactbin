import { it, expect, vi } from "vitest";
import { useAppHarness, mintAccountToken, request } from "@/__tests__/harness";
import { POST } from "@/app/api/artifacts/route";
import { GET, PUT } from "@/app/api/artifacts/[id]/route";
import { POST as REVERT } from "@/app/api/artifacts/[id]/revert/route";
import { requestOrSessionActor } from "@/lib/accounts";
import { getDb } from "@/lib/platform";
import { getArtifactById, changeMembership } from "@/lib/artifacts";
import { setDatasetPolicy } from "@/lib/document-data/dataset-policy";
import { catalogOf } from "@/lib/datasets/catalog";
import { loadDatasetRows } from "@/lib/datasets/dataset-store";
import { getHtmlBackendVersion } from "@/lib/html-backends";
import type { HtmlBackendLink } from "@artifactbin/contracts";
import { pageGraphql } from "@/lib/page-graphql";
import {
  prepareRegisteredMutationBackend,
  commitRegisteredMutationBackend,
  registeredMutationPlan,
  repairRegisteredMutationHead,
} from "../registry";
import { registeredMutationDescriptor } from "../namespace";
import type { MutationProgram } from "../contracts";
vi.mock("@/lib/page-operations", async (original) => ({
  ...(await original<typeof import("@/lib/page-operations")>()),
  compilePageBackend: async (source: string) => ({
    typeDefs: "type Query { total: Float }",
    compiled: source,
    secretBindings: [],
  }),
}));
useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const link = '<link rel="af-backend" data-af-name="actions" href="./actions.ts">';
const html = (body: string, declared = true) =>
  `<!doctype html><html><head><title>Rebind</title>${declared ? link : ""}</head><body>${body}</body></html>`;
const provenance = { compilerSha256: "a".repeat(64), sourceSha256: "b".repeat(64) };
/** A migrated page: its head carries a registered `actions` mutation program bound to that head. */
async function migratedPage() {
  const owner = await mintAccountToken("mutation_rebind_owner"),
    editor = await mintAccountToken("mutation_rebind_editor"),
    stranger = await mintAccountToken("mutation_rebind_stranger");
  const actor = await requestOrSessionActor(request("/api/artifacts", { token: owner.token }));
  const make = async (json: object) => {
    const reply = await POST(request("/api/artifacts", { method: "POST", token: owner.token, json }));
    expect(reply.status).toBe(201);
    return (await reply.json()).id as string;
  };
  const datasetId = await make({ dataset: [{ body: "seed" }], visibility: "private" }),
    pageId = await make({ html: html("<p>Migrated</p>", false), visibility: "public" });
  await setDatasetPolicy(actor, datasetId, { version: 2, allow: [{ actions: ["read", "insert"], from: { user: "$owner" } }] }, 0);
  await changeMembership(actor, pageId, { action: "join" });
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')", [
    pageId,
    editor.userId,
    editor.email,
  ]);
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
  // Import shape: the registered head is also present in artifact_versions.
  const source = html("<p>Migrated</p>");
  const row = (await db.query<{ version: number }>("SELECT version FROM artifacts WHERE id=$1", [pageId])).rows[0]!;
  const page = { pageId, version: row.version + 1, html: source };
  const prepared = prepareRegisteredMutationBackend("actions", `native_${pageId}`, page, structuredClone(program), provenance);
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE artifacts SET version=$2,source=$3,meta=jsonb_set(meta,'{htmlLinks}',$4::jsonb) WHERE id=$1",
      [pageId, page.version, source, JSON.stringify([prepared.link])],
    );
    await tx.query(
      "INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1",
      [pageId],
    );
    await commitRegisteredMutationBackend(tx, page, owner.userId!, prepared);
  });
  const head = async (token = owner.token) =>
    (await (await GET(request(`/api/artifacts/${pageId}`, { token }), params(pageId))).json()) as {
      html: string;
      version: number;
      state: string;
    };
  const save = async (token: string, body: Record<string, unknown>) => {
    const current = await head(token);
    return PUT(
      request(`/api/artifacts/${pageId}`, {
        method: "PUT",
        token,
        json: { expectedVersion: current.version, expectedState: current.state, ...body },
      }),
      params(pageId),
    );
  };
  const stored = async () =>
    (
      await db.query<{ version: number; source: string; meta: { htmlLinks?: HtmlBackendLink[] } }>(
        "SELECT version,source,meta FROM artifacts WHERE id=$1",
        [pageId],
      )
    ).rows[0]!;
  const descriptor = registeredMutationDescriptor("actions", program);
  let requests = 0;
  /** The page's mutation, run by its owner over GraphQL at the current head revision. */
  const run = async (body: string) => {
    const now = await stored();
    const response = await pageGraphql(
      request(`/api/artifacts/${pageId}/graphql`, {
        method: "POST",
        token: owner.token,
        json: {
          revision: String(now.version),
          query: descriptor.document,
          variables: { requestId: `rebind_request_${String(++requests).padStart(8, "0")}`, values: { body } },
        },
      }),
      pageId,
    );
    return { status: response.status, body: await response.json() };
  };
  const rows = async () => {
    const dataset = (await getArtifactById(datasetId))!,
      table = catalogOf(dataset)!.tables[0]!;
    return loadDatasetRows({ meta: { objectKey: table.objectKey } });
  };
  const expected = async () => {
    const current = await head();
    return { expectedVersion: current.version, expectedState: current.state };
  };
  return { owner, editor, stranger, pageId, prepared, program, db, save, stored, run, rows, expected };
}
type Fixture = Awaited<ReturnType<typeof migratedPage>>;
const plan = async (f: Fixture) => {
  const now = await f.stored();
  const link = now.meta.htmlLinks!.find((l) => l.name === "actions")!;
  const record = (await getHtmlBackendVersion(link.backendId, link.version))!;
  return {
    now,
    link,
    record,
    plan: registeredMutationPlan({ pageId: f.pageId, version: now.version, html: now.source, links: now.meta.htmlLinks! }, link, record),
  };
};
const expectCommitted = async (f: Fixture, body: string) => {
  const answer = await f.run(body);
  expect(answer.status).toBe(200);
  expect(answer.body.errors).toBeUndefined();
  expect(answer.body.data.actions.run).toMatchObject({ outcome: "committed", affected: 1 });
};

it("an owner save re-binds the registered mutation to the new version, same program and provenance", async () => {
  const f = await migratedPage();
  await expectCommitted(f, "before edit");
  const saved = await f.save(f.owner.token, { html: html("<p>Owner edit</p>") });
  expect(saved.status).toBe(200);
  const after = await plan(f);
  expect(after.link.backendId).toBe(f.prepared.link.backendId);
  expect(after.link.version).not.toBe(f.prepared.link.version);
  expect(after.plan?.registration.pageVersion).toBe(after.now.version);
  const envelope = JSON.parse(after.record.source);
  expect(envelope.program).toEqual(f.prepared.envelope.program);
  expect(envelope.provenance).toEqual(provenance);
  expect(after.record.ownerId).toBe(f.owner.userId);
  // The edited head is not archived yet; the mutation still commits against it.
  await expectCommitted(f, "after edit");
  expect(await f.rows()).toEqual([{ body: "seed" }, { body: "before edit" }, { body: "after edit" }]);
});

it("an editor save re-binds under the page owner, and repeated saves keep working", async () => {
  const f = await migratedPage();
  expect((await f.save(f.editor.token, { html: html("<p>Editor edit</p>") })).status).toBe(200);
  await expectCommitted(f, "one");
  expect((await plan(f)).record.ownerId).toBe(f.owner.userId);
  expect((await f.save(f.editor.token, { html: html("<p>Editor edit two</p>") })).status).toBe(200);
  await expectCommitted(f, "two");
  expect((await f.save(f.stranger.token, { html: html("<p>No access</p>") })).status).toBe(404);
});

it("a revert re-binds the restored registration to the new version", async () => {
  const f = await migratedPage();
  const original = (await f.stored()).version;
  expect((await f.save(f.owner.token, { html: html("<p>Owner edit</p>") })).status).toBe(200);
  const reverted = await REVERT(
    request(`/api/artifacts/${f.pageId}/revert`, {
      method: "POST",
      token: f.owner.token,
      json: { version: original, ...(await f.expected()) },
    }),
    params(f.pageId),
  );
  expect(reverted.status).toBe(200);
  expect((await plan(f)).plan?.registration.pageVersion).toBe((await f.stored()).version);
  await expectCommitted(f, "after revert");
});

it("a replacement supplied in backendSources wins over the carried registered mutation", async () => {
  const f = await migratedPage();
  const saved = await f.save(f.owner.token, {
    html: html("<p>Ordinary backend</p>"),
    backendSources: { actions: "export const Query = { total: () => 1 };" },
  });
  expect(saved.status).toBe(200);
  const after = await plan(f);
  expect(after.link.backendId).toBe(f.prepared.link.backendId);
  expect(after.plan).toBeNull();
  expect(after.record.compiled.startsWith("!registered-page-")).toBe(false);
});

it("removing the namespace drops the link; it is not carried", async () => {
  const f = await migratedPage();
  expect((await f.save(f.owner.token, { html: html("<p>No actions</p>", false) })).status).toBe(200);
  expect((await f.stored()).meta.htmlLinks ?? []).toEqual([]);
});

it("a carried mutation that cannot be re-bound refuses the save explicitly and writes nothing", async () => {
  const f = await migratedPage();
  const before = await f.stored();
  // The page changed owner after migration: the program's owner no longer owns the page.
  await f.db.query("UPDATE html_backend_versions SET owner_id=$2 WHERE backend_id=$1", [
    f.prepared.link.backendId,
    f.stranger.userId,
  ]);
  const refused = await f.save(f.owner.token, { html: html("<p>Owner edit</p>") });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    error: "registered_mutations_rebind_failed",
    namespace: "actions",
    reason: "mutation_registration_owner_changed",
  });
  expect((await f.stored()).version).toBe(before.version);
  // Tampered stored bytes are refused the same way.
  await f.db.query(
    "UPDATE html_backend_versions SET owner_id=$2, source=replace(source,'forms.rows','forms.other') WHERE backend_id=$1",
    [f.prepared.link.backendId, f.owner.userId],
  );
  const tampered = await f.save(f.owner.token, { html: html("<p>Owner edit</p>") });
  expect(tampered.status).toBe(409);
  expect((await tampered.json()).reason).toBe("mutation_registration_changed");
  expect((await f.stored()).version).toBe(before.version);
});

it("repairs a head saved before mutation re-binding existed, in place, and leaves valid heads alone", async () => {
  const f = await migratedPage();
  // Simulate the old bug: a save that kept the link bound to the previous version.
  const stale = await f.stored();
  await f.db.query(
    "INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1 ON CONFLICT DO NOTHING",
    [f.pageId],
  );
  await f.db.query("UPDATE artifacts SET version=version+1,source=$2 WHERE id=$1", [f.pageId, html("<p>Edited before the fix</p>")]);
  const broken = await f.run("refused");
  expect(broken.status !== 200 || broken.body.errors).toBeTruthy();
  const repaired = await f.db.transaction((tx) => repairRegisteredMutationHead(tx, f.pageId));
  expect(repaired).toEqual(["actions"]);
  expect((await f.stored()).version).toBe(stale.version + 1);
  expect((await plan(f)).plan?.registration.pageVersion).toBe(stale.version + 1);
  await expectCommitted(f, "repaired");
  expect(await f.db.transaction((tx) => repairRegisteredMutationHead(tx, f.pageId))).toEqual([]);
});
