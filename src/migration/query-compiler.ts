import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MigrationQueryCompiler,
  MigrationQueryCompilerOutput,
} from "./query-preparation-contracts.ts";
/** Bounded syntax/SQL compilation; raw stderr may contain private source and is discarded. */
export function createMigrationQueryCompiler(
  legacyRoot: string,
): MigrationQueryCompiler {
  const root = path.resolve(legacyRoot);
  return (input) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=512",
          "--import",
          path.join(root, "node_modules/tsx/dist/loader.mjs"),
          fileURLToPath(
            new URL("./query-compiler-runner.mts", import.meta.url),
          ),
          root,
        ],
        {
          cwd: path.join(root, "services/app"),
          env: {
            PATH: process.env.PATH ?? "",
            NODE_ENV: "development",
            TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const chunks: Buffer[] = [];
      let bytes = 0,
        settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(Error("query_compilation_refused"));
      };
      const timer = setTimeout(fail, 30000);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) fail();
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        if (code !== 0) {
          fail();
          return;
        }
        try {
          const output = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as MigrationQueryCompilerOutput | null;
          settled = true;
          resolve(output);
        } catch {
          fail();
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
}
