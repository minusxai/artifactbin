import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { standaloneDatasetFixture, standaloneDatasetHost } from "./support/standalone-dataset.ts";
import { scanStandaloneDatasetPages, datasetPageArtifactSha256 } from "../src/migration/dataset-pages/scan.ts";
import { prepareStandaloneDatasetJob } from "../src/migration/dataset-pages/job.ts";
import { prepareMigrationBackends } from "../src/migration/backend-preparation.ts";
import { planDatasetMetadata } from "../src/migration/datasets/import-metadata.ts";
import { additiveRowSha256 } from "../src/migration/dataset-pages/additive-authority.ts";
import { createMigrationJobPlanner } from "../src/migration/job-planning.ts";

async function externalHistoryFixture() {
  const { artifact, source, options } = standaloneDatasetFixture(true);
  artifact.version = 2;
  const old = { ...artifact, artifact_id: artifact.id, version: 1, edit_id: "saved-external-edit", user_id: "original-owner" };
  const manifest = { ...(await source.readArtifact(artifact.id)), tables: { artifact_versions: [old] } };
  source.readArtifact = async () => manifest;
  const admission = options.standaloneDatasetPages!;
  admission.heads = [{ ...admission.heads[0]!, version: 2, artifactSha256: datasetPageArtifactSha256(artifact) }];
  admission.history = { kind: "standalone-dataset-history-v1", revisions: [{ legacyId: artifact.id, version: 1, artifactSha256: datasetPageArtifactSha256(old) }] };
  const queries = [old, artifact].map(row => {
    const sql = `SELECT ${row.version} AS n`;
    return { pageLegacyId: artifact.id, pageVersion: row.version, name: "table0", sourceRef: "ref:" + artifact.id, resource: "source-" + artifact.id, sql, sqlSha256: createHash("sha256").update(sql).digest("hex"), params: {}, columns: [{ name: "n", type: "number" as const }] };
  });
  admission.external = queries.map(query => ({ legacyId: artifact.id, version: query.pageVersion, artifactSha256: datasetPageArtifactSha256(query.pageVersion === 2 ? artifact : old), declarations: `<Helmet><Query name="table0" source="ref:${artifact.id}">{${JSON.stringify(query.sql)}}</Query></Helmet>`, queries: [query] }));
  options.sourceQueryRegistrations = queries;
  admission.heads[0]!.resourceSha256 = additiveRowSha256(planDatasetMetadata({
    manifest: { ...source.base, artifacts: [artifact], tables: { ...source.base.tables, relations: [] } },
    maps: source.maps, receipts: source.datasets!.receipts, bindings: [],
    relationProvenance: { exportedAt: source.base.exportedAt, manifestSha256: "b".repeat(64) },
  }).metadata.resources[0]);
  return { artifact, source, options, queries, manifest };
}

test("external saved queries preserve per-version authority while only head declares current viewer reads", async () => {
  const { artifact, source, options, queries, manifest } = await externalHistoryFixture();
  const scan = await scanStandaloneDatasetPages(source, options);
  const revisions = scan.pages[0]!.revisions;
  assert.equal(revisions.find(r => r.version === 1)!.readsViewer, undefined);
  assert.equal(revisions.find(r => r.version === 2)!.readsViewer, true);
  assert.deepEqual(revisions.map(r => r.sourceQueries![0]!.pageVersion).sort(), [1, 2]);
  const prepared = await prepareStandaloneDatasetJob(source, options, { host: standaloneDatasetHost });
  assert.equal(prepared.issues.size, 0);
  const receipts = prepared.backends.get(artifact.id)!;
  assert.deepEqual(receipts.map(r => r.pageVersion).sort(), [1, 2]);
  for (const receipt of receipts) {
    assert.equal(receipt.owner, scan.pages[0]!.owner.id);
    assert.deepEqual(receipt.viewer, receipt.pageVersion === 2 ? { sourceNamespace: "fixture" } : undefined);
    assert.equal(receipt.historicalSourceQueries?.pageVersion, receipt.pageVersion === 1 ? 1 : undefined);
    assert.equal(receipt.sourceQueries, true);
    assert.equal(receipt.standaloneExternalDataset!.pageVersion, receipt.pageVersion);
  }
  assert.deepEqual(prepared.sourceQueryRegistrations!.flatMap(g => g.queries).sort((a,b) => a.pageVersion-b.pageVersion), queries);
  assert.deepEqual(prepared.metadata.pages.map(p => p.pageVersion).sort(), [1, 2]);
  source.preparedDatasets = prepared;
  const plan = await createMigrationJobPlanner(source, options, async () => { throw Error("not markup"); })(manifest);
  assert.equal(plan.pages[0]!.disposition, "ready");
  assert.deepEqual(plan.pages[0]!.revisions.map(r => r.version).sort(), [1, 2]);
  for (const revision of plan.pages[0]!.revisions) {
    assert.equal(revision.conversion.classification, "functional");
    assert.ok(revision.conversion.html!.includes(receipts.find(r => r.pageVersion === revision.version)!.backendId));
    assert.ok(!revision.conversion.html!.includes("SELECT"));
  }
});

test("historical query exception requires exact standalone provenance and version-bound registrations", async () => {
  const { source, options } = await externalHistoryFixture();
  const scan = await scanStandaloneDatasetPages(source, options);
  const input = { sourceNamespace: "fixture", origin: "https://example.test", allocatedIds: options.standaloneDatasetPages!.reservedFileIds, pages: scan.pages };
  for (const mutate of [
    (r: typeof scan.pages[0]["revisions"][number]) => ({ ...r, readsViewer: true as const }),
    (r: typeof scan.pages[0]["revisions"][number]) => ({ ...r, standaloneExternalDataset: undefined }),
    (r: typeof scan.pages[0]["revisions"][number]) => ({ ...r, sourceQueries: r.sourceQueries!.map(q => ({ ...q, pageVersion: 2 })) }),
  ]) {
    const pages = scan.pages.map(p => ({ ...p, revisions: p.revisions.map(r => r.version === 1 ? mutate(r) : r) }));
    await assert.rejects(prepareMigrationBackends({ ...input, pages }, { host: standaloneDatasetHost }), /Invalid migration backend preparation/);
  }
});

test("external history allocation preserves the head ID and retries globally reserved saved IDs deterministically", async () => {
  const { source, options } = await externalHistoryFixture();
  const scan = await scanStandaloneDatasetPages(source, options);
  const input = { sourceNamespace:"fixture", origin:"https://example.test", allocatedIds:options.standaloneDatasetPages!.reservedFileIds, pages:scan.pages };
  const prepared = await prepareMigrationBackends(input,{host:standaloneDatasetHost});
  const head = prepared.receipts.find(r=>r.pageVersion===2)!, saved=prepared.receipts.find(r=>r.pageVersion===1)!;
  assert.notEqual(head.backendId,saved.backendId);
  const alone = await prepareMigrationBackends({...input,pages:scan.pages.map(p=>({...p,revisions:p.revisions.filter(r=>r.version===2)}))},{host:standaloneDatasetHost});
  assert.equal(alone.receipts[0]!.backendId,head.backendId);
  const reserved={...input,allocatedIds:[...input.allocatedIds,saved.backendId]};
  const first=await prepareMigrationBackends(reserved,{host:standaloneDatasetHost});
  const retry=await prepareMigrationBackends(reserved,{host:standaloneDatasetHost});
  assert.notEqual(first.receipts.find(r=>r.pageVersion===1)!.backendId,saved.backendId);
  assert.deepEqual(first.receipts.map(r=>r.backendId),retry.receipts.map(r=>r.backendId));
  assert.equal(first.receipts.find(r=>r.pageVersion===2)!.backendId,head.backendId);
});

test("historical query persistence rejects a different namespace before querying storage", async () => {
  const {registerSourceQueries,verifySourceQueries}=await import("../src/persistence/source-queries.ts");
  const {source,options}=await externalHistoryFixture();
  const prepared=await prepareStandaloneDatasetJob(source,options,{host:standaloneDatasetHost});
  const group=prepared.sourceQueryRegistrations!.find(g=>g.receipt.historicalSourceQueries)!;
  const database={query:async()=>{throw Error("storage must not be queried");}};
  await assert.rejects(registerSourceQueries(database,group.receipt,"different-source",group.queries),/historical source query authority/);
  await assert.rejects(verifySourceQueries(database,group.receipt,"different-source",group.queries),/historical source query authority/);
});
