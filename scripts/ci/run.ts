import { spawn } from "node:child_process";
import { inventory, selectTests } from "./inventory.ts";
const [kind, shardValue, totalValue] = process.argv.slice(2);
const shard = Number(shardValue),
  total = Number(totalValue);
if (kind !== "node") throw Error("Expected a node shard");
const files = selectTests(inventory(), shard, total);
const argv = [process.execPath, "--import", "tsx", "--test", "--test-concurrency=2", ...files];
console.log(`Running ${files.length} test files`);
const start = performance.now();
const child = spawn(argv[0]!, argv.slice(1), { stdio: "inherit", env: process.env });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  console.log(`Finished node shard ${shard}/${total}: ${((performance.now() - start) / 1000).toFixed(1)}s`);
  process.exitCode = code ?? 1;
});
