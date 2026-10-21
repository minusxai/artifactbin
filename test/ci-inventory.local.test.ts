import { test } from "node:test";
import assert from "node:assert/strict";
import { inventory, selectTests, setupRequirements } from "../scripts/ci/inventory.ts";
import { discoverTests, setupRequirements as required } from "../scripts/testing/inventory.ts";

test("CI shards run every discovered test file exactly once, v2 acceptance tests included", () => {
  const all = inventory();
  assert.deepEqual(all.testFiles, discoverTests().map((item) => item.file));
  assert.ok(all.testFiles.some((file) => file.startsWith("test/v2/")));
  for (const total of [1, 3, 4]) {
    const files = Array.from({ length: total }, (_, shard) => selectTests(all, shard, total)).flat();
    assert.deepEqual(files.sort(), [...all.testFiles].sort(), `${total} shards`);
    assert.equal(new Set(files).size, files.length);
  }
});

test("invalid shard coordinates fail rather than silently omitting coverage", () => {
  assert.throws(() => selectTests(inventory(), 4, 4));
  assert.throws(() => selectTests(inventory(), -1, 4));
  assert.throws(() => setupRequirements("node", 0, 0));
  assert.throws(() => setupRequirements("browser", 0, 4), /Unknown CI setup kind/);
});

test("workflow timing counts the entire attempt rather than summed parallel job times", async () => {
  const { workflowTiming } = await import("../scripts/ci/timing.js");
  assert.equal(workflowTiming("2026-01-01T00:00:00Z", "2026-01-01T00:02:00Z").withinBudget, true);
  assert.equal(workflowTiming("2026-01-01T00:00:00Z", "2026-01-01T00:02:00.001Z").withinBudget, false);
  assert.throws(() => workflowTiming("invalid", new Date().toISOString()));
});

test("Node shards keep Postgres, the backend image and browser engines apart, and prepare what they run", () => {
  const all = inventory(),
    descriptors = discoverTests();
  const expected = [new Set(["database"]), new Set(["unit", "local"]), new Set(["isolate"]), new Set(["browser"])];
  for (const shard of [0, 1, 2, 3]) {
    const selected = new Set(selectTests(all, shard, 4));
    assert.ok(selected.size > 0, `shard ${shard} has tests`);
    for (const file of selected) {
      const descriptor = descriptors.find((item) => item.file === file)!;
      assert.ok(expected[shard]!.has(descriptor.capability), `${shard}: ${file}`);
    }
    const needs = required(descriptors.filter((item) => selected.has(item.file)));
    assert.deepEqual(setupRequirements("node", shard, 4), {
      browsers: needs.browsers,
      backend: needs.backend,
      postgres: needs.postgres,
    });
  }
  assert.deepEqual(setupRequirements("node", 0, 4), { browsers: [], backend: false, postgres: true });
  assert.deepEqual(setupRequirements("node", 1, 4), { browsers: [], backend: false, postgres: false });
  assert.deepEqual(setupRequirements("node", 3, 4).browsers, ["chromium", "firefox", "webkit"]);
  assert.deepEqual(setupRequirements("validate", 0, 4), { browsers: [], backend: false, postgres: false });
});

test("a single node shard prepares every discovered test capability", () => {
  assert.deepEqual(setupRequirements("node", 0, 1), { browsers: ["chromium", "firefox", "webkit"], backend: true, postgres: true });
});

test("setup exports the browser execution location and cache only for actual host capabilities", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { browserRuntimePlan } = await import("../scripts/ci/browser-runtime.ts");
  const directory = mkdtempSync(join(tmpdir(), "pagegi-ci-runtime-"));
  try {
    for (const [kind, shard] of [["validate", 0], ["node", 2], ["node", 3]] as const) {
      const output = join(directory, `${kind}-${shard}.output`),
        env = `${output}.env`;
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/ci/setup-requirements.ts", kind, String(shard)], {
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_ENV: env },
      });
      assert.equal(result.status, 0, result.stderr);
      const plan = browserRuntimePlan(setupRequirements(kind, shard, 4).browsers);
      assert.match(readFileSync(env, "utf8"), new RegExp(`^PAGEGI_CI_BROWSER_IMAGE=${plan.kind === "image"}$`, "m"));
      assert.match(readFileSync(output, "utf8"), new RegExp(`^host-browsers=${plan.kind === "host" ? plan.engines.join("-") : ""}$`, "m"));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("host execution preserves failure diagnostics without invoking a browser container", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "pagegi-ci-host-"));
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "%s\\n" "$PAGEGI_BROWSER_DIAGNOSTICS_DIR" "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, "docker"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const result = spawnSync("bash", ["scripts/ci/run-container.sh", "node", "3", "4"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: directory, PAGEGI_CI_BROWSER_IMAGE: "false" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [
      join(directory, "pagegi-browser-diagnostics"),
      "--import",
      "tsx",
      "scripts/ci/run.ts",
      "node",
      "3",
      "4",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
