import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readStreamManifest, readPartRows } from "./stream.ts";
import { verifyMediaBytes } from "./media-receipts.ts";
import type { StreamManifest } from "./stream-contracts.ts";
import type { MigrationDatasetSource } from "./dataset-source-contracts.ts";
import type { DatasetObjectReceipt } from "./datasets/planner-contracts.ts";
/** Verify private source bytes and keep only bounded receipts/relations, never rows or document bodies. */
export async function readMigrationDatasetSource(options: {
  baseDirectory: string;
  base: StreamManifest;
  relationDirectory: string;
  receiptsPath: string;
}): Promise<MigrationDatasetSource> {
  const baseBytes = await readFile(
    join(options.baseDirectory, "manifest.json"),
  );
  if (
    JSON.stringify(JSON.parse(baseBytes.toString("utf8"))) !==
    JSON.stringify(options.base)
  )
    throw new Error("Base export provenance changed");
  const relation = await readStreamManifest(options.relationDirectory);
  const raw = JSON.parse(
    await readFile(join(options.relationDirectory, "manifest.json"), "utf8"),
  );
  if (
    relation.sourceNamespace !== options.base.sourceNamespace ||
    relation.schema !== options.base.schema ||
    raw.supplemental !== true ||
    raw.consistency !== "independent-repeatable-read-read-only" ||
    raw.supplementsExportedAt !== options.base.exportedAt ||
    relation.parts.some((p) => p.table !== "relations")
  )
    throw new Error(
      "Supplemental relations do not match base export provenance",
    );
  if (
    relation.parts.reduce((sum, p) => sum + p.bytes, 0) > 32 * 1024 * 1024 ||
    relation.parts.reduce((sum, p) => sum + p.rows, 0) > 100_000
  )
    throw new Error(
      "Supplemental relations exceed bounded migration metadata limit",
    );
  const relations = [];
  for (const part of relation.parts)
    for await (const row of readPartRows(options.relationDirectory, part))
      relations.push(row);
  const info = await lstat(options.receiptsPath);
  if (!info.isFile() || info.size > 32 * 1024 * 1024)
    throw new Error("Invalid bounded dataset receipts");
  const rawReceipts: unknown = JSON.parse(
    await readFile(options.receiptsPath, "utf8"),
  );
  if (!Array.isArray(rawReceipts)) throw new Error("Invalid dataset receipts");
  const receipts: DatasetObjectReceipt[] = [];
  const keys = new Set<string>();
  let verifiedBytes = 0;
  for (const row of rawReceipts) {
    if (
      !row ||
      typeof row !== "object" ||
      row.status !== "copied" ||
      typeof row.objectKey !== "string" ||
      !/^dataset\/[a-f0-9]{32}$/.test(row.objectKey) ||
      keys.has(row.objectKey) ||
      typeof row.path !== "string" ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0
    )
      throw new Error("Missing unique verified dataset receipt");
    keys.add(row.objectKey);
    await verifyMediaBytes(row.path, row.bytes, row.sha256);
    verifiedBytes += row.bytes;
    receipts.push({
      objectKey: row.objectKey,
      status: "copied",
      bytes: row.bytes,
      sha256: row.sha256,
    });
  }
  const hash = async (directory: string) =>
    createHash("sha256")
      .update(await readFile(join(directory, "manifest.json")))
      .digest("hex");
  return {
    receipts,
    relations,
    provenance: {
      baseManifestSha256: createHash("sha256").update(baseBytes).digest("hex"),
      relationManifestSha256: await hash(options.relationDirectory),
      relationExportedAt: relation.exportedAt,
    },
    verifiedObjects: receipts.length,
    verifiedBytes,
  };
}
