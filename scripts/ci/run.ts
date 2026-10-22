import { spawn } from "node:child_process";
import { inventory, selectTests } from "./inventory.ts";
import { discoverTests, setupRequirements } from "../testing/inventory.ts";
import { guardReport, guardedEnvironment } from "../testing/backend-guard.ts";
const [kind, shardValue, totalValue] = process.argv.slice(2);
const shard = Number(shardValue),
  total = Number(totalValue);
if (kind !== "node") throw Error("Expected a node shard");
const files = selectTests(inventory(), shard, total);
const selected = new Set(files);
// A shard that declares no backend image cannot start one, even on a runner that has it.
const env = guardedEnvironment(
  setupRequirements(discoverTests().filter((test) => selected.has(test.file))),
  process.env,
);
const argv = [
  process.execPath,
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=2",
  ...files,
];
console.log(`Running ${files.length} test files`);
const start = performance.now();
const child = spawn(argv[0]!, argv.slice(1), { stdio: "inherit", env });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  const refused = guardReport(env);
  if (refused)
    console.error(
      `Backend image refusals in shard ${shard}/${total}:\n${refused}`,
    );
  console.log(
    `Finished node shard ${shard}/${total}: ${((performance.now() - start) / 1000).toFixed(1)}s`,
  );
  process.exitCode = code ?? 1;
});
