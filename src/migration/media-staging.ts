import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { verifyMediaBytes } from "./media-receipts.ts";
import type { MigratedAsset } from "./media-contracts.ts";
/** Immutable local staging only; exclusive content addresses cannot overwrite existing bytes. */
export async function stageMigrationMedia(
  assets: readonly MigratedAsset[],
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.mode & 0o077)
    throw new Error("Media staging directory must be private");
  const seen = new Set<string>();
  for (const asset of assets) {
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 0
    )
      throw new Error("Invalid staged media address");
    if (seen.has(asset.sha256)) continue;
    seen.add(asset.sha256);
    const target = join(directory, asset.sha256);
    try {
      await verifyMediaBytes(target, asset.bytes, asset.sha256);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = target + "." + randomUUID() + ".partial";
    const file = await open(temporary, "wx", 0o600);
    try {
      await verifyMediaBytes(asset.path, asset.bytes, asset.sha256, file);
      await file.sync();
      await file.close();
      try {
        await link(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await verifyMediaBytes(target, asset.bytes, asset.sha256);
      }
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
}
