import { serveSql, sqlClient } from "@artifactbin/sql";
import { createSql } from "@artifactbin/sql/local";
import { services, setServices } from "@/lib/platform/services";
import { overrideConfig } from "@/lib/platform/config";
import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken, request } from "@/__tests__/harness";
import { POST } from "@/app/api/artifacts/route";
import { getDb } from "@/lib/platform";
import { readHtmlPage } from "@/lib/html-publication";
import { ANONYMOUS_ACTOR } from "@/lib/accounts";
import { requestOrSessionActor } from "@/lib/authentication";
import { getArtifactById, readableArtifactIdentity } from "@/lib/artifacts";
import { createRetainedRegisteredQueries } from "@/lib/page-graphql/registered-queries";
import { executeCatalog } from "@/lib/datasets/execute";
import { prepareRegisteredQueryBackend, commitRegisteredQueryBackend, registeredPlan } from "../registry";
import { getHtmlBackendVersion } from "@/lib/html-backends";
useAppHarness();
it("an evaluation reads the page source once at admission and fences on its head identity, still refusing a republish", async () => {
  const previousSql = services().sql,
    pool = createSql({ timeoutMs: 5000 }, { workers: 1 }),
    server = serveSql(pool),
    remote = server.listen(0);
  overrideConfig({ sqlServiceUrl: remote.url });
  setServices({ sql: sqlClient(remote.url) });
  try {
    const owner = await mintAccountToken("fence_reads_fixture");
    const actor = await requestOrSessionActor(request("/api/artifacts", { token: owner.token }));
    const dataset = await (await POST(request("/api/artifacts", { method: "POST", token: owner.token, json: { dataset: [{ amount: 2 }, { amount: 4 }], visibility: "public" } }))).json();
    const created = await (await POST(request("/api/artifacts", { method: "POST", token: owner.token, json: { html: "<html><body><p>Totals</p></body></html>", visibility: "public" } }))).json();
    const original = await readHtmlPage(actor, created.id),
      page = { ...original, version: original.version + 1, revision: String(original.version + 1) };
    const registration = prepareRegisteredQueryBackend(
      "queries",
      "fence_reads_backend",
      page,
      { scalars: {}, queries: [{ name: "total", sql: "select sum(amount) as amount from items.rows", dependencies: [] }], imports: [{ alias: "items", binding: dataset.id, table: "rows" }] },
      { compilerSha256: "a".repeat(64), sourceSha256: "b".repeat(64), sqlEngineSha256: "c".repeat(64) },
    );
    page.links = [registration.link];
    await (await getDb()).transaction(async (tx) => {
      await tx.query("UPDATE artifacts SET version=$2,meta=jsonb_set(meta,'{htmlLinks}',$3::jsonb) WHERE id=$1", [page.pageId, page.version, JSON.stringify(page.links)]);
      await tx.query("INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1", [page.pageId]);
      await commitRegisteredQueryBackend(tx, page, owner.userId!, registration);
    });
    const plan = registeredPlan(page, registration.link, (await getHtmlBackendVersion(registration.link.backendId, registration.link.version))!)!;
    const counts = { page: 0, document: 0, header: 0, windows: 0 };
    const evaluate = (readIdentity: typeof readableArtifactIdentity = readableArtifactIdentity, signal = new AbortController().signal) =>
      createRetainedRegisteredQueries(ANONYMOUS_ACTOR, page, {
        readPage: (...args) => { counts.page++; return readHtmlPage(...args); },
        readDocument: (id) => { counts.document++; return getArtifactById(id); },
        readIdentity: (...args) => { counts.header++; return readIdentity(...args); },
        readWindow: async (...args) => { counts.windows++; await new Promise((resolve) => setTimeout(resolve, 50)); return executeCatalog(...args); },
      }).execute({ ...plan.registration, subject: null }, { values: {}, only: ["total"] }, signal);
    expect(await evaluate()).toMatchObject({ total: { rows: [{ amount: 6 }] } });
    expect(counts.page, "the page source is read once, at admission").toBe(1);
    expect(counts.document).toBe(1);
    expect(counts.header, "every later fence rereads the head identity").toBeGreaterThan(2);
    // Simultaneous evaluations (one page load sends one per table) share one read of the same dataset revision.
    counts.windows = 0;
    const together = await Promise.all([evaluate(), evaluate(), evaluate()]);
    for (const answer of together) expect(answer).toMatchObject({ total: { rows: [{ amount: 6 }] } });
    expect(counts.windows, "one shared window read").toBe(1);
    // A joiner that leaves does not cancel the read for the others; nothing is kept once it settles.
    counts.windows = 0;
    const leaving = new AbortController();
    const left = evaluate(undefined, leaving.signal);
    const stays = evaluate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    leaving.abort(Error("reader left"));
    await expect(left).rejects.toThrow();
    expect(await stays).toMatchObject({ total: { rows: [{ amount: 6 }] } });
    expect(await evaluate()).toMatchObject({ total: { rows: [{ amount: 6 }] } });
    expect(counts.windows, "a settled read is not reused").toBe(2);
    // A republish between fences changes the head identity: the evaluation is refused, as when it reread the source.
    let fences = 0;
    await expect(
      evaluate(async (reader, id) => {
        const head = await readableArtifactIdentity(reader, id);
        return head && ++fences > 1 ? { ...head, row: { ...head.row, edit_id: "republished" } } : head;
      }),
    ).rejects.toThrow("query_document_changed");
    // So is a head the reader can no longer read.
    await expect(evaluate(async () => null)).rejects.toThrow("query_registration_changed");
  } finally {
    setServices({ sql: previousSql });
    await server.close();
    await pool.close();
  }
});
