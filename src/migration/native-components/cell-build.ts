import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { NativeAssemblyFile } from "./assemble-contracts.ts";
import type { NativeCellAdapter } from "./cell-contracts.ts";
export { formatNativeLiveCell } from "./cell-runtime.ts";
export async function buildNativeCellAdapter(): Promise<{
  files: NativeAssemblyFile[];
  adapter: NativeCellAdapter;
}> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./cell-runtime.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
  });
  const bytes = result.outputFiles[0]!.contents,
    sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    files: [{ path: "components/native-cell.js", bytes, sha256 }],
    adapter: { specifier: "./components/native-cell.js", sha256 },
  };
}
