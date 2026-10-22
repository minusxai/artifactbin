import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { externalCompile } from "../src/migration/conversion/compiled/index.ts";
test(
  "compiler retires inherited decoder descendants before timeout or successful completion",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "compiler-owner-"));
    try {
      await mkdir(path.join(root, "services/app"), { recursive: true });
      await symlink(
        path.resolve("node_modules"),
        path.join(root, "node_modules"),
      );
      await writeFile(path.join(root, "tsconfig.json"), "{}");
      for (const hold of [true, false]) {
        const pidFile = path.join(root, `pid-${hold}`),
          runner = path.join(root, `runner-${hold}.mjs`);
        await writeFile(
          runner,
          `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));${hold ? "setInterval(()=>{},1000)" : 'child.unref();console.log(JSON.stringify({html:"ok"}))'}`,
        );
        const operation = externalCompile(
          { source: "<p/>", coreUrl: "/af/v1/core.js" },
          { legacyRoot: root, timeoutMs: 1500 },
          pathToFileURL(runner).href,
        );
        if (hold) await assert.rejects(() => operation, /timed out/);
        else assert.equal((await operation).html, "ok");
        const pid = Number(await readFile(pidFile, "utf8"));
        // A killed orphan may briefly remain a zombie until the OS reaps it. It must not execute.
        let alive = true;
        for (let i = 0; i < 50; i++) {
          try {
            process.kill(pid, 0);
          } catch {
            alive = false;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        assert.equal(
          alive,
          false,
          "decoder remains alive after compiler settles",
        );
      }
      const early = path.join(root, "early.mjs");
      await writeFile(early, "process.exit(1)");
      await assert.rejects(() =>
        externalCompile(
          { source: "x".repeat(4_000_000), coreUrl: "/af/v1/core.js" },
          { legacyRoot: root, timeoutMs: 1500 },
          pathToFileURL(early).href,
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
