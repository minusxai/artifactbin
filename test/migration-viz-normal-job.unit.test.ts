import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exportLegacyStream } from "../src/migration/stream.ts";
import { prepareMigrationJobSource } from "../src/migration/job-source.ts";
import { runMigrationJob } from "../src/migration/job.ts";
import { standaloneDatasetFixture } from "./support/standalone-dataset.ts";
import { additiveRowSha256 } from "../src/migration/dataset-pages/additive-authority.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
test("normal destinationless viz job preserves saved versions and never compiles unrelated sources or opens destination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viz-normal-"));
  try {
    const { artifact, source, options } = standaloneDatasetFixture(),
      base = options.standaloneDatasetPages!.base;
    delete options.standaloneDatasetPages;
    const row = {
      ...artifact,
      id: "recipe",
      format: "viz",
      version: 2,
      source: JSON.stringify({
        description: "Recipe",
        engine: "vega-lite",
        bindings: [{ name: "x", label: "X", accepts: ["nominal"] }],
        template: {
          mark: "bar",
          encoding: { x: { field: "{{x}}", type: "{{x:kind}}" } },
        },
      }),
      meta: null,
    };
    const old = {
      ...row,
      id: "previous",
      artifact_id: "recipe",
      version: 1,
      source: row.source + "\n",
    };
    const tables: Record<string, unknown[]> = {
      users: source.base.tables.users!,
      artifacts: [
        row,
        {
          ...artifact,
          id: "other",
          format: "markup",
          source: "<p>Unrelated</p>",
        },
      ],
      artifact_versions: [old],
    };
    let selected = "",
      fetched = false;
    await exportLegacyStream(
      {
        query: async (sql) => {
          if (sql.startsWith("DECLARE")) {
            selected = Object.keys(tables).find((k) =>
              sql.includes('"' + k + '"'),
            )!;
            fetched = false;
          }
          if (sql.startsWith("FETCH")) {
            if (fetched) return { rows: [] };
            fetched = true;
            return { rows: tables[selected] as Record<string, unknown>[] };
          }
          return { rows: [] };
        },
      },
      {
        schema: "legacy",
        sourceNamespace: "fixture",
        directory: join(dir, "source"),
        now: () => new Date(0),
      },
      Object.keys(tables),
    );
    options.sourceDirectory = join(dir, "source");
    options.indexDirectory = join(dir, "index");
    options.reportPath = join(dir, "report");
    const indexed = await prepareMigrationJobSource(options),
      sourceRow = (await indexed.readArtifact("recipe")).artifacts[0]!,
      history = (await indexed.readArtifact("recipe")).tables
        .artifact_versions![0]!;
    const bytes = JSON.stringify({
      complete: true,
      readOnly: true,
      compilerIdentity: "fixture",
      runtime: { pages: 0 },
      archives: [
        { manifestSha256: base.inventory.baseManifestSha256 },
        { manifestSha256: base.inventory.relationManifestSha256 },
      ],
    });
    const path = join(dir, "verified.json");
    await writeFile(path, bytes);
    base.verificationReport = { path, sha256: sha(bytes) };
    options.standaloneVizPages = {
      admission: {
        kind: "standalone-viz-pages-v1",
        sourceNamespace: "fixture",
        base,
        heads: [
          {
            legacyId: "recipe",
            pageId: indexed.maps.pages.recipe!,
            version: 2,
            artifactSha256: additiveRowSha256(sourceRow),
            sourceSha256: sha(row.source),
            versions: [
              { version: 1, artifactSha256: additiveRowSha256(history) },
              { version: 2, artifactSha256: additiveRowSha256(sourceRow) },
            ],
          },
        ],
      },
      baseInputs: {
        batch: {
          ...source.datasets!.provenance,
          metadata: {
            sourceNamespace: "fixture",
            resources: [],
            versions: [],
            bindings: [],
            pages: [],
            principals: [],
            groups: [],
            acceptedJoins: [],
          },
        },
      },
    };
    const result = await runMigrationJob(options, {
      compilerIdentity: async () => "fixture",
      convert: () => {
        throw Error("Unexpected unrelated compiler");
      },
      connectDestination: async () => {
        throw Error("Unexpected destination");
      },
    });
    assert.equal(result.result.blocked, 0);
    assert.equal(result.result.errors, 0);
    const rows = (await readFile(options.reportPath, "utf8"))
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legacyId, "recipe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
