/** Offline font inspection subprocess: binary data only, no author source. */
import { createRequire } from "node:module";
import path from "node:path";
import { validateWoff2Bounds } from "./woff2.ts";
import { inspectSfnt } from "./inspect.ts";
let size = 0;
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 2_000_000) throw Error("Font byte limit");
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
validateWoff2Bounds(bytes);
const require = createRequire(
  path.join(path.resolve(process.argv[2] ?? ""), "package.json"),
);
const expanded = await require("wawoff2").decompress(bytes);
if (
  expanded.byteLength !== bytes.readUInt32BE(16) ||
  expanded.byteLength > 4_000_000
)
  throw Error("Font expansion mismatch");
process.stdout.write(JSON.stringify(inspectSfnt(expanded)));
