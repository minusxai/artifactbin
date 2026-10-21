import { spawnSync } from "node:child_process";
import { setupRequirements } from "./inventory.ts";
const [kind = "validate", shard = "0", total = "4", engine = "chromium"] = process.argv.slice(2);
if (setupRequirements(kind, Number(shard), Number(total), engine).postgres) {
  const result = spawnSync("bash", ["scripts/ci/start-postgres.sh"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
