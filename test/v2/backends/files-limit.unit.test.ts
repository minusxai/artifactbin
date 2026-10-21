import { test } from "node:test";
import assert from "node:assert/strict";
import type { BackendFilesModule } from "../../../src/backend/af-backend-contracts.ts";
import { load } from "../support/load.ts";
import { skillFile } from "../support/skill.ts";
import { compileOnlyHost } from "../support/todo.ts";

test("the files port refuses a batch over its limit before compiling any of it", async () => {
  const { createBackendFiles } = await load<BackendFilesModule>("src/backend/af-files.ts");
  let compiles = 0;
  const host = compileOnlyHost();
  const files = createBackendFiles({ host: { ...host, compile: (source, signal) => (compiles++, host.compile(source, signal)) } });
  const source = skillFile("examples/backends/todos.ts");
  const batch = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`Ab${String(i).padStart(4, "0")}`, source]));
  await assert.rejects(files.compile(batch), /at most 64 backend files/);
  assert.equal(compiles, 0);
});
