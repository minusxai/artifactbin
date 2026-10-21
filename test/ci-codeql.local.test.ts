import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CodeQL init configuration stays inside its checked-out workspace", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pagegi-codeql-config-"));
  const output = join(workspace, "outputs");
  try {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/ci/prepare-codeql.ts", "a"],
      {
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          GITHUB_OUTPUT: output,
          RUNNER_TEMP: tmpdir(),
        },
      },
    );
    const config = readFileSync(output, "utf8").trim().slice("config=".length);
    assert.equal(config, join(workspace, ".pagegi-codeql-config.yml"));
    assert.match(readFileSync(config, "utf8"), /query-filters:/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
