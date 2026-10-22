import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InspectedFont } from "./contracts.ts";
import { validateWoff2Bounds } from "./woff2.ts";
/** Decoder runs separately with a hard timeout, bounded input and bounded metadata output. */
export function createCapturedFontInspector(
  legacyRoot: string,
  ports: { spawnProcess?: typeof spawn } = {},
) {
  const root = path.resolve(legacyRoot);
  return async (
    bytes: Uint8Array,
    outerSignal: AbortSignal,
  ): Promise<InspectedFont> => {
    validateWoff2Bounds(bytes);
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(5000)]);
    return await new Promise((resolve, reject) => {
      const child = (ports.spawnProcess ?? spawn)(
        process.execPath,
        [
          "--max-old-space-size=64",
          "--import",
          path.join(root, "node_modules/tsx/dist/loader.mjs"),
          fileURLToPath(
            new URL("./capture-inspect-runner.mts", import.meta.url),
          ),
          root,
        ],
        {
          signal,
          killSignal: "SIGKILL",
          cwd: root,
          env: {
            PATH: process.env.PATH ?? "",
            TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"),
          },
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      let size = 0,
        failed = false;
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64_000) {
          child.kill("SIGKILL");
          failed = true;
          return;
        }
        chunks.push(chunk);
      });
      child.stdin.on("error", () => {});
      child.on("error", () => {
        failed = true;
      });
      child.on("close", (code) => {
        if (failed || code !== 0 || signal.aborted) {
          reject(Error("Font inspection failed"));
          return;
        }
        try {
          resolve(
            JSON.parse(Buffer.concat(chunks).toString("utf8")) as InspectedFont,
          );
        } catch {
          reject(Error("Font inspection result refused"));
        }
      });
      child.stdin.end(bytes);
    });
  };
}
