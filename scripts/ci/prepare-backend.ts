import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { setupRequirements } from "./inventory.ts";
const [kind, shard, total, engine = "chromium"] = process.argv.slice(2);
if (setupRequirements(kind!, Number(shard), Number(total), engine).backend) {
  const archive = process.env.RUNNER_TEMP
    ? join(process.env.RUNNER_TEMP, "pagegi-backend-image.tar")
    : undefined;
  function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (archive && existsSync(archive)) {
    console.log("Backend image cache: hit; loading exact source-keyed image");
    run("docker", ["load", "--input", archive]);
  } else {
    console.log("Backend image cache: miss; building exact checked context");
    run("npm", ["run", "build:backend"]);
    if (archive)
      run("docker", ["save", "--output", archive, "pagegi-backend:local"]);
  }
  run("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    "pagegi-backend:local",
  ]);
}

if (setupRequirements(kind!, Number(shard), Number(total), engine).backend) {
  const archive = process.env.RUNNER_TEMP
    ? join(process.env.RUNNER_TEMP, "pagegi-dataset-sql-image.tar")
    : undefined;
  function run(args: string[]): void {
    const result = spawnSync("docker", args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (archive && existsSync(archive)) run(["load", "--input", archive]);
  else {
    run([
      "build",
      "-f",
      "src/datasets/sql/container/Dockerfile",
      "-t",
      "pagegi-dataset-sql:local",
      ".",
    ]);
    if (archive) run(["save", "--output", archive, "pagegi-dataset-sql:local"]);
  }
  run(["image", "inspect", "--format", "{{.Id}}", "pagegi-dataset-sql:local"]);
}
