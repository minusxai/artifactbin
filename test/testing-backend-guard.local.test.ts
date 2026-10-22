import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  GUARD_EXIT_CODE,
  guardReport,
  guardedEnvironment,
  refusedImages,
} from "../scripts/testing/backend-guard.ts";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

test("a stage without the backend image refuses the product images by name and passes other docker commands through", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-guard-"));
  try {
    const real = join(root, "real"),
      guard = join(root, "guard");
    mkdirSync(real);
    mkdirSync(guard);
    writeFileSync(join(real, "docker"), '#!/bin/sh\necho "real docker: $*"\n', {
      mode: 0o755,
    });
    const env = guardedEnvironment(
      { backend: false },
      { PATH: real, PAGEGI_BACKEND_IMAGE: "registry.example/backend:2026" },
      () => guard,
    );
    assert.ok(
      env.PATH!.startsWith(guard + delimiter),
      "the guard comes first on PATH",
    );
    const refused = refusedImages(env);
    assert.deepEqual(refused, [
      "registry.example/backend:2026",
      "pagegi-dataset-sql:local",
      "pagegi-image-processor:local",
    ]);
    for (const tag of refused) {
      const inspect = spawnSync(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", tag],
        { env, encoding: "utf8" },
      );
      assert.equal(inspect.status, GUARD_EXIT_CODE, tag);
      assert.equal(inspect.stdout, "", "nothing reaches the real CLI");
      assert.match(inspect.stderr, /declares no backend image/);
      assert.match(inspect.stderr, new RegExp(escape(tag)));
      assert.match(inspect.stderr, /staged \.isolate/);
      const create = spawnSync(
        "docker",
        ["create", "--pull=never", "--name", "x", tag],
        { env, encoding: "utf8" },
      );
      assert.equal(create.status, GUARD_EXIT_CODE, tag);
    }
    const through = spawnSync(
      "docker",
      ["ps", "-aq", "--filter", "label=pagegi-backend=1"],
      { env, encoding: "utf8" },
    );
    assert.equal(through.status, 0, through.stderr);
    assert.equal(
      through.stdout.trim(),
      "real docker: ps -aq --filter label=pagegi-backend=1",
    );
    const named = spawnSync(
      "docker",
      ["rm", "--force", "pagegi-backend-local-1"],
      { env, encoding: "utf8" },
    );
    assert.equal(
      named.status,
      0,
      "only the exact tag is refused, not names that contain it",
    );
    const report = guardReport(env).trim().split("\n");
    assert.equal(
      report.length,
      refused.length * 2,
      "one report line per refusal, none for commands passed through",
    );
    assert.ok(report.every((line) => /declares no backend image/.test(line)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the default backend tag is refused when no image override is set, and a missing CLI stays missing", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-guard-"));
  try {
    const env = guardedEnvironment(
      { backend: false },
      { PATH: join(root, "nowhere") },
      () => root,
    );
    assert.deepEqual(refusedImages(env), [
      "pagegi-backend:local",
      "pagegi-dataset-sql:local",
      "pagegi-image-processor:local",
    ]);
    const inspect = spawnSync(
      "docker",
      ["image", "inspect", "pagegi-backend:local"],
      { env, encoding: "utf8" },
    );
    assert.equal(inspect.status, GUARD_EXIT_CODE);
    const other = spawnSync("docker", ["version"], { env, encoding: "utf8" });
    assert.equal(other.status, 127);
    assert.match(other.stderr, /not installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stage that declares the backend image runs in its own environment, with no guard written", () => {
  const env = { PATH: "/usr/bin" };
  assert.equal(
    guardedEnvironment({ backend: true }, env, () => {
      throw Error("no guard directory for an isolate stage");
    }),
    env,
  );
});

test("a sandbox started from a stage without the backend image fails at once with the staging rule, not a hang or a missing-image error", () => {
  const env = guardedEnvironment({ backend: false }, process.env);
  const script = [
    'import { createBackendHost } from "./src/backend/container-host.ts";',
    'const host = createBackendHost({ sandboxNetwork: "bridge", log: () => {} });',
    "try {",
    '  await host.compile("export default { Query: {} }");',
    '  console.log("compiled");',
    "} catch (error) {",
    '  console.log("failed: " + (error instanceof Error ? error.message : String(error)));',
    "} finally {",
    "  await host.close().catch(() => {});",
    "}",
  ].join("\n");
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^failed: backend_unavailable$/m,
    "the host reports the sandbox as unavailable",
  );
  assert.ok(
    performance.now() - started < 30_000,
    "the refusal is immediate, not a compile timeout",
  );
  // The host swallows docker's stderr, so the rule is recorded for the runner to print after the stage.
  const report = guardReport(env);
  assert.match(report, /declares no backend image/);
  assert.match(report, new RegExp(escape(refusedImages(env)[0]!)));
  assert.match(report, /staged \.isolate/);
});
