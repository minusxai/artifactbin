import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import {
  inventoryAssets,
  type AssetArchiveRow,
} from "../../src/migration/assets/inventory.ts";
import { readStreamManifest } from "../../src/migration/stream.ts";
import type { StreamPart } from "../../src/migration/stream-contracts.ts";

// No source credentials, network access, object reads or source writes belong in inventory.
const [sourceDirectory, outputDirectory] = process.argv.slice(2);
if (!sourceDirectory || !outputDirectory)
  throw new Error(
    "Usage: node scripts/migration/assets-inventory.ts <private-snapshot-directory> <new-private-output-directory>",
  );
const manifest = await readStreamManifest(sourceDirectory);
async function* readAssetPart(
  part: StreamPart,
): AsyncGenerator<AssetArchiveRow> {
  if (part.table !== "artifacts" && part.table !== "artifact_versions")
    throw new Error("Unexpected asset inventory table");
  const path = resolve(sourceDirectory!, part.path);
  if (!path.startsWith(resolve(sourceDirectory!) + sep))
    throw new Error("Invalid inventory archive path");
  const info = await stat(path);
  if (info.size !== part.bytes) throw new Error("Asset archive size mismatch");
  const source = createReadStream(path);
  const hash = createHash("sha256");
  let bytes = 0,
    rows = 0;
  source.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.byteLength;
  });
  const completed = finished(source);
  void completed.catch(() => {});
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) throw new Error("Empty asset archive row");
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("Invalid asset archive row");
      rows++;
      yield { table: part.table, row: row as Record<string, unknown> };
    }
    await completed;
    if (
      rows !== part.rows ||
      bytes !== part.bytes ||
      hash.digest("hex") !== part.sha256
    )
      throw new Error("Asset archive verification failed");
  } finally {
    lines.close();
    source.destroy();
  }
}
async function* assetRows(): AsyncGenerator<AssetArchiveRow> {
  for (const part of manifest.parts)
    if (part.table === "artifacts" || part.table === "artifact_versions")
      yield* readAssetPart(part);
}
const inventory = await inventoryAssets(assetRows());
await mkdir(outputDirectory, { mode: 0o700 });
async function save(name: string, value: unknown) {
  const path = join(outputDirectory!, name);
  const file = await open(path + ".partial", "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(path + ".partial", path);
}
await save("plan.json", inventory.plan);
await save("warnings.json", inventory.warnings);
await save("summary.json", inventory.summary);
// Published last as commit marker; source metadata remains private.
await save("manifest.json", {
  schemaVersion: 1,
  sourceNamespace: manifest.sourceNamespace,
  exportedAt: manifest.exportedAt,
  sourcePartCount: manifest.parts.length,
  assetPartCount: manifest.parts.filter(
    (part) => part.table === "artifacts" || part.table === "artifact_versions",
  ).length,
  summary: inventory.summary,
});
process.stdout.write(JSON.stringify(inventory.summary) + "\n");
