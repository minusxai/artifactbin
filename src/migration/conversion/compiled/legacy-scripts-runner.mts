import {extendLegacyParamsCodemod} from "./legacy-params-codemod.ts";
/** Runs the exact retired source-only codemod, never any authored JavaScript. */
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { LEGACY_SCRIPT_CODEMOD_SHA256 } from "./legacy-scripts.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
const root = path.resolve(process.argv[2]!);
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > MAX_COMPILED_SOURCE_BYTES * 2)
    throw Error("Input exceeds limit");
}
const input = JSON.parse(text);
if (
  typeof input.source !== "string" ||
  Buffer.byteLength(input.source) > MAX_COMPILED_SOURCE_BYTES
)
  throw Error("Invalid source");
let source = await readFile(
  new URL("./legacy-script-codemod.ts.txt", import.meta.url),
  "utf8",
);
if (
  createHash("sha256").update(source).digest("hex") !==
  LEGACY_SCRIPT_CODEMOD_SHA256
)
  throw Error("Codemod integrity mismatch");
source=extendLegacyParamsCodemod(source);
const imports: Record<string, string> = {
  "@babel/core": "node_modules/@babel/core/lib/index.js",
  "@artifactbin/utils/escape": "services/utils/src/escape.ts",
  "@/lib/jsx/parse": "services/app/lib/jsx/parse.ts",
  "@/lib/jsx/types": "services/app/lib/jsx/types.ts",
  "@/lib/document/helmet": "services/app/lib/document/helmet.ts",
};
for (const [specifier, relative] of Object.entries(imports)) {
  const quoted = "'" + specifier + "'";
  if (!source.includes(quoted)) throw Error("Codemod dependency mismatch");
  source = source.replace(
    quoted,
    JSON.stringify(pathToFileURL(path.join(root, relative)).href),
  );
}
const { transform } = await import(
  pathToFileURL(path.join(root, "node_modules/esbuild/lib/main.js")).href
);
const compiled = await transform(source, {
  loader: "ts",
  format: "esm",
  target: "es2022",
});
const dir = await mkdtemp(path.join(tmpdir(), "page-source-normalization-"));
try {
  const file = path.join(dir, "codemod.mjs");
  await writeFile(file, compiled.code, { mode: 0o600 });
  const { migrateDocumentScripts } = await import(pathToFileURL(file).href);
  process.stdout.write(JSON.stringify(migrateDocumentScripts(input.source)));
} finally {
  await rm(dir, { recursive: true, force: true });
}
