import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportLegacyStream } from "../src/migration/stream.ts";
import { runMigrationJob } from "../src/migration/job.ts";
import type { MigrationJobOptions } from "../src/migration/job-contracts.ts";
async function fixture(
  directory: string,
  bad = false,
  count = 3,
  history = false,
): Promise<MigrationJobOptions> {
  let table = "";
  let fetched = false;
  const artifacts = Array.from({ length: count }, (_, i) =>
    i.toString(36).padStart(6, "0"),
  ).map((id) => ({
    id,
    format: "markup",
    version: bad ? 0 : history ? 2 : 1,
    user_id: "u",
    group_id: null,
    token_id: "",
    source: "<p>Fixture</p>",
    document: null,
    visibility: "private",
    link_role: "viewer",
  }));
  await exportLegacyStream(
    {
      query: async (sql) => {
        if (sql.startsWith("DECLARE")) {
          table = sql.includes('"users"') ? "users" : sql.includes('"artifact_versions"') ? "artifact_versions" : "artifacts";
          fetched = false;
        }
        if (sql.startsWith("FETCH")) {
          if (fetched) return { rows: [] };
          fetched = true;
          return {
            rows:
              table === "users"
                ? [{ id: "u", email: "owner@example.test" }]
                : table === "artifact_versions" ? artifacts.map(a=>({artifact_id:a.id,version:1,format:"markup",source:"unsupported"})) : artifacts,
          };
        }
        return { rows: [] };
      },
    },
    {
      schema: "legacy",
      sourceNamespace: "fixture",
      directory: join(directory, "source"),
      now: () => new Date(0),
    },
    history ? ["users", "artifacts", "artifact_versions"] : ["users", "artifacts"],
  );
  return {
    sourceDirectory: join(directory, "source"),
    indexDirectory: join(directory, "index"),
    schema: "isolated_fixture",
    reportPath: join(directory, "report.ndjson"),
    apply: false,
    concurrency: 2,
    origin: "http://localhost:8787",
    legacyOrigins: [],
    editorManageRestricted: true,
    conversionStrategy: "strict",
  };
}
for (const concurrency of [1, 2, 3, 4, 8] as const)
  test(`typed dry-run job bounds conversion concurrency at ${concurrency} without opening a destination`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "migration-job-"));
    try {
      const options = await fixture(directory, false, 16);
      options.concurrency = concurrency;
      let active = 0,
        peak = 0,
        calls = 0,
        connections = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const summary = await runMigrationJob(options, {
        connectDestination: async () => {
          connections++;
          throw new Error("No destination permitted");
        },
        convert: async () => {
          active++;
          peak = Math.max(peak, active);
          if (++calls === concurrency) release();
          await gate;
          active--;
          return {
            classification: "renderable",
            html: "<p>Fixture</p>",
            issues: [],
            identities: {},
          };
        },
      });
      assert.equal(peak, concurrency);
      assert.equal(calls, 16);
      assert.equal(connections, 0);
      assert.equal(summary.inventory.markup?.ready, 16);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
for (const capacity of [undefined, "operator-verified"] as const)
test(`failed complete preflight never opens an actual destination (${capacity ?? "default"})`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-job-"));
  try {
    const options = await fixture(directory, true);
    let connections = 0;
    await assert.rejects(
      runMigrationJob(
        { ...options, apply: true, concurrency: 1, storageCapacity: capacity },
        {
          connectDestination: async () => {
            connections++;
            throw new Error("Should not connect");
          },
        },
      ),
      /Invalid or duplicate source revision/,
    );
    assert.equal(connections, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const capacity of [undefined, "operator-verified"] as const)
test(`compiler provenance changes abort before destination connects (${capacity ?? "default"})`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-provenance-"));
  try {
    const options = await fixture(directory);
    options.apply = true;
    options.storageCapacity = capacity;
    options.concurrency = 1;
    let identities = 0,
      connections = 0;
    await assert.rejects(
      runMigrationJob(options, {
        compilerIdentity: async () => (++identities === 1 ? "before" : "after"),
        convert: () => ({
          classification: "renderable",
          html: "<p>Fixture</p>",
          issues: [],
          identities: {},
        }),
        connectDestination: async () => {
          connections++;
          throw new Error("Must not connect");
        },
      }),
      /provenance changed/,
    );
    assert.equal(connections, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("read-only storage measurement reproduces final normalized UTF8 bytes without opening destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-size-"));
  try {
    const options = await fixture(directory);
    options.measureStorage = true;
    const summary = await runMigrationJob(options, {
      compilerIdentity: async () => "pinned",
      connectDestination: async () => {
        throw Error("Must not connect");
      },
      convert: () => ({
        classification: "renderable",
        html: "<p>Résumé 🌍</p>",
        issues: [],
        identities: {},
      }),
    });
    assert.equal(summary.storageReport, options.reportPath + ".storage.json");
    const report = JSON.parse(await readFile(summary.storageReport!, "utf8"));
    assert.equal(report.destinationWrite, false);
    assert.equal(report.postgresAllocationEstimate, false);
    assert.equal(report.measurement.pages, 3);
    assert.equal(report.measurement.sources, 3);
    assert.ok(
      report.measurement.normalizedSourceBytes >
        3 * Buffer.byteLength("<p>Résumé 🌍</p>"),
    );
    assert.equal(report.measurement.rawArchiveRows, 4);
    assert.equal(report.compilerIdentity, "pinned");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("typed job passes the trusted runtime owner only to destination preparation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-role-job-"));
  try {
    const options = await fixture(directory);
    let closed = 0,
      switched = 0;
    await assert.rejects(
      runMigrationJob(
        {
          ...options,
          apply: true,
          concurrency: 1,
          runtimeOwnerRole: "runtime_owner",
        },
        {
          convert: () => ({
            classification: "renderable",
            html: "<p>Fixture</p>",
            issues: [],
            identities: {},
          }),
          connectDestination: async () => ({
            db: {
              query: async (sql) => {
                if (sql === "SELECT current_user AS role")
                  return { rows: [{ role: "migration_role" }] };
                if (sql === 'SET LOCAL ROLE "runtime_owner"') {
                  switched++;
                  throw Error("scoped owner boundary reached");
                }
                return { rows: [] };
              },
            },
            close: async () => {
              closed++;
            },
          }),
        },
      ),
      /scoped owner boundary reached/,
    );
    assert.equal(switched, 1);
    assert.equal(closed, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit historical policy reports unavailable revisions separately while keeping the exact working head ready", async () => {
 const directory=await mkdtemp(join(tmpdir(),"migration-history-job-"));
 try {
 const options=await fixture(directory,false,1,true);options.historicalUnavailable="preserve";
 const result=await runMigrationJob(options,{convert:({source})=>source==="unsupported"?{classification:"manual-blocked",html:null,issues:[{code:"compiled-source"}],identities:{}}:{classification:"functional",html:"<p>Working current head</p>",issues:[],identities:{}}});
 assert.deepEqual(result.historicalUnavailable,{pages:1,revisions:1});assert.equal(result.inventory.markup!.ready,1);assert.equal(result.inventory.markup!.blocked,0);
 const report=JSON.parse((await readFile(options.reportPath,"utf8")).trim());assert.deepEqual(report.revisions.map((r:{classification:string})=>r.classification),["historical-unavailable","functional"]);assert.equal(report.revisions[0].historicalUnavailable.version,1);
 const readiness=JSON.parse(await readFile(result.readinessReport,"utf8"));assert.deepEqual(readiness.historicalUnavailable,{pages:1,revisions:1});assert.equal(readiness.readiness.ready.length,1);
 } finally {await rm(directory,{recursive:true,force:true});}
});

for (const capacity of [undefined, "operator-verified"] as const)
  test(`apply ${capacity ?? "default"} preserves preflight and controls only aggregate measurement`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "migration-capacity-"));
    try {
      const options = await fixture(directory);
      options.apply = true;
      options.concurrency = 1;
      options.storageCapacity = capacity;
      let calls = 0,
        connections = 0;
      await assert.rejects(
        runMigrationJob(options, {
          compilerIdentity: async () => "pinned",
          convert: () => {
            calls++;
            return {
              classification: "renderable",
              html: "<p>Fixture</p>",
              issues: [],
              identities: {},
            };
          },
          connectDestination: async () => {
            connections++;
            throw Error("destination boundary");
          },
        }),
        /destination boundary/,
      );
      assert.equal(connections, 1);
      assert.equal(calls, capacity ? 3 : 6);
      if (capacity)
        await assert.rejects(readFile(options.reportPath + ".storage.json"), {
          code: "ENOENT",
        });
      else
        assert.equal(
          JSON.parse(
            await readFile(options.reportPath + ".storage.json", "utf8"),
          ).measurement.pages,
          3,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
for (const changes of [
  { apply: false },
  { apply: true, measureStorage: true },
  { apply: true, verifyOnly: true },
  { apply: true, storageCapacity: "unknown" },
])
  test(`capacity attestation refuses incompatible configuration ${JSON.stringify(changes)}`, async () => {
    const options = {
      sourceDirectory: "missing",
      indexDirectory: "missing",
      schema: "isolated_fixture",
      reportPath: "missing",
      concurrency: 1,
      origin: "http://localhost",
      legacyOrigins: [],
      editorManageRestricted: true,
      conversionStrategy: "strict",
      storageCapacity: "operator-verified",
      ...changes,
    } as MigrationJobOptions;
    await assert.rejects(runMigrationJob(options), /capacity/i);
  });
