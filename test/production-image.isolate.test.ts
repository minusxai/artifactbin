import test from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("production image excludes offline migration tooling and the JSX parser", (t) => {
  const image = "pagegi-packaging-test:" + randomUUID();
  const docker = (...args: string[]) => execFileSync("docker", args, { stdio: "pipe" });
  docker("build", "-t", image, ".");
  t.after(() => docker("image", "rm", image));
  docker("run", "--rm", "--entrypoint", "node", image, "-e", `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    for (const path of ['src/migration', 'scripts/migration', 'node_modules/acorn-jsx'])
      assert.equal(fs.existsSync(path), false, path + ' must be offline only');
    assert.ok(fs.existsSync('src/server-main.js'));
    assert.ok(fs.existsSync('dist/runner.js'));
  `);
});
