import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import type { MigrationMediaIndex, MigratedAsset } from "./media-contracts.ts";
async function readJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 32 * 1024 * 1024)
    throw new Error("Invalid bounded media manifest");
  return JSON.parse(await readFile(path, "utf8"));
}
export async function verifyMediaBytes(
  path: string,
  bytes: number,
  sha256: string,
  copy?: Awaited<ReturnType<typeof open>>,
): Promise<void> {
  const source = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await source.stat();
    if (!info.isFile() || info.size !== bytes)
      throw new Error("Media length differs from receipt");
    const hash = createHash("sha256");
    let count = 0;
    for await (const chunk of source.createReadStream({ autoClose: false })) {
      count += chunk.length;
      if (count > bytes) throw new Error("Media length exceeds receipt");
      hash.update(chunk);
      if (copy) await copy.writeFile(chunk);
    }
    if (count !== bytes || hash.digest("hex") !== sha256)
      throw new Error("Media digest differs from receipt");
  } finally {
    await source.close();
  }
}
export async function readMigrationMedia(
  planPath: string,
  receiptPath: string,
): Promise<MigrationMediaIndex> {
  const plan = (await readJson(planPath)) as {
    objects: Record<string, unknown>[];
  };
  const receipts = (await readJson(receiptPath)) as Record<string, unknown>[];
  if (!Array.isArray(plan.objects) || !Array.isArray(receipts))
    throw new Error("Invalid media plan");
  const byKey = new Map<string, Record<string, unknown>>();
  for (const receipt of receipts) {
    const key = String(receipt.objectKey);
    if (byKey.has(key)) throw new Error("Duplicate media receipt");
    byKey.set(key, receipt);
  }
  const assets: MigratedAsset[] = [];
  const references = new Set<string>();
  const objects = new Set<string>();
  for (const object of plan.objects) {
    const key = String(object.objectKey);
    if (objects.has(key)) throw new Error("Duplicate media object");
    objects.add(key);
    const receipt = byKey.get(key);
    if (
      !receipt ||
      receipt.status !== "copied" ||
      typeof receipt.path !== "string" ||
      typeof receipt.sha256 !== "string" ||
      !/^([a-f0-9]{64})$/.test(receipt.sha256) ||
      !Number.isSafeInteger(receipt.bytes) ||
      Number(receipt.bytes) < 0
    )
      throw new Error("Missing verified media receipt");
    const bytes = Number(receipt.bytes);
    if (object.expectedBytes !== undefined && object.expectedBytes !== bytes)
      throw new Error("Media expected length differs from receipt");
    await verifyMediaBytes(receipt.path, bytes, receipt.sha256);
    if (
      !Array.isArray(object.references) ||
      typeof object.contentType !== "string" ||
      !/^[-\w.+]+\/[-\w.+]+$/.test(object.contentType)
    )
      throw new Error("Invalid media descriptor");
    for (const reference of object.references) {
      const ref = reference as Record<string, unknown>;
      if (
        typeof ref.artifactId !== "string" ||
        !Number.isSafeInteger(ref.version) ||
        Number(ref.version) < 1 ||
        !["original", "small"].includes(String(ref.variant))
      )
        throw new Error("Invalid media reference");
      const identity = JSON.stringify([
        ref.artifactId,
        ref.version,
        ref.variant,
      ]);
      if (references.has(identity))
        throw new Error("Ambiguous media reference");
      references.add(identity);
      assets.push({
        artifactId: ref.artifactId,
        version: Number(ref.version),
        variant: ref.variant as "original" | "small",
        sha256: receipt.sha256,
        bytes,
        path: receipt.path,
        contentType: object.contentType,
        filename: typeof ref.filename === "string" ? ref.filename : null,
        ...(Number.isSafeInteger(ref.width) && Number(ref.width) > 0
          ? { width: Number(ref.width) }
          : {}),
      });
    }
  }
  return { assets, verifiedObjects: objects.size };
}
