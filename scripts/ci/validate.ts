import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface ValidationCommand {
  executable: string;
  args: string[];
}
export interface ValidationOptions {
  node?: string;
  cacheDirectory?: string;
}

export function validationCommands({
  node = process.execPath,
  cacheDirectory = "node_modules/.cache/pagegi/typecheck",
}: ValidationOptions = {}): ValidationCommand[] {
  return [
    ...[
      "tsconfig.json",
      "src/browser/tsconfig.json",
    ].map((config, index) => ({
      executable: node,
      args: [
        "node_modules/typescript/bin/tsc",
        "--noEmit",
        "-p",
        config,
        "--incremental",
        "--tsBuildInfoFile",
        `${cacheDirectory}/${index}.tsbuildinfo`,
      ],
    })),
    { executable: node, args: ["scripts/check-boundaries.ts"] },
  ];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const command of validationCommands()) {
    const result = spawnSync(command.executable, command.args, {
      stdio: "inherit",
    });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
