import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validationCommands } from "../scripts/ci/validate.ts";

test("cached validation rechecks changed sources, imports, and compiler options for every config", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-validation-"));
  try {
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    for (const command of validationCommands({
      cacheDirectory: ".cache",
    }).filter((command) => command.args.includes("-p"))) {
      const config = command.args[command.args.indexOf("-p") + 1]!;
      const configPath = join(root, config);
      mkdirSync(dirname(configPath), { recursive: true });
      const original = JSON.parse(readFileSync(config, "utf8"));
      const options = { ...original.compilerOptions };
      const configBody = () =>
        JSON.stringify({
          compilerOptions: options,
          files: ["./probe.js", "./value.ts"],
        });
      writeFileSync(configPath, configBody());
      const probe = join(dirname(configPath), "probe.js");
      const value = join(dirname(configPath), "value.ts");
      writeFileSync(
        probe,
        '// @ts-check\nimport { value } from "./value.ts";\n/** @type {number} */\nconst result = value;\nexport { result };\n',
      );
      writeFileSync(value, "export const value = 1;\n");
      const run = () =>
        spawnSync(command.executable, command.args, {
          cwd: root,
          encoding: "utf8",
        });
      for (let warm = 0; warm < 2; warm++)
        assert.equal(run().status, 0, config);
      writeFileSync(value, 'export const value = "wrong";\n');
      const invalid = run();
      assert.notEqual(invalid.status, 0, config);
      assert.match(invalid.stdout, /probe\.js.*TS2322/, config);
      writeFileSync(value, "export const value = 1;\n");
      assert.equal(run().status, 0, config);
      options.noUnusedLocals = true;
      writeFileSync(configPath, configBody());
      writeFileSync(value, "const unused = 1; export const value = 1;\n");
      const changedConfig = run();
      assert.notEqual(changedConfig.status, 0, config);
      assert.match(changedConfig.stdout, /TS6133/, config);
      options.noUnusedLocals = false;
      writeFileSync(configPath, configBody());
      assert.equal(run().status, 0, config);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation exits unsuccessfully for compiler and architectural failures", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-validation-exit-"));
  try {
    mkdirSync(join(root, "scripts/ci"), { recursive: true });
    mkdirSync(join(root, "node_modules/typescript/bin"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(root, "scripts/ci/validate.ts"),
      readFileSync("scripts/ci/validate.ts"),
    );
    const compiler = join(root, "node_modules/typescript/bin/tsc");
    const boundary = join(root, "scripts/check-boundaries.ts");
    writeFileSync(compiler, "process.exit(2);");
    writeFileSync(
      boundary,
      'throw new Error("must not run after compiler failure");',
    );
    const run = () =>
      spawnSync(process.execPath, ["scripts/ci/validate.ts"], {
        cwd: root,
        encoding: "utf8",
      });
    const compilerFailure = run();
    assert.equal(compilerFailure.status, 2);
    assert.doesNotMatch(compilerFailure.stderr, /must not run/);
    writeFileSync(compiler, "process.exit(0);");
    writeFileSync(boundary, "process.exit(3);");
    assert.equal(run().status, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
