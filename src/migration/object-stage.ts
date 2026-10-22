import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  realpath,
  mkdir,
  open,
  link,
  unlink,
  chown,
  chmod,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyMediaBytes } from "./media-receipts.ts";
import type {
  MigrationObjectStageEntry,
  MigrationObjectStagePlan,
  MigrationObjectStageReceipt,
} from "./object-stage-contracts.ts";
export function createMigrationObjectStagePlan(
  entries: readonly MigrationObjectStageEntry[],
): MigrationObjectStagePlan {
  const sorted = [...entries].sort((a, b) =>
    (a.store + "/" + a.sha256).localeCompare(b.store + "/" + b.sha256),
  );
  const seen = new Set<string>();
  let bytes = 0;
  const lengths = new Map<string, number>();
  if (!sorted.length || sorted.length > 100000)
    throw Error("Invalid object staging count");
  for (const e of sorted) {
    const key = e.store + "/" + e.sha256;
    if (
      !["media", "datasets"].includes(e.store) ||
      !/^[a-f0-9]{64}$/.test(e.sha256) ||
      !Number.isSafeInteger(e.bytes) ||
      e.bytes < 0 ||
      seen.has(key)
    )
      throw Error("Invalid object staging entry");
    if (lengths.has(e.sha256) && lengths.get(e.sha256) !== e.bytes)
      throw Error("Conflicting content length");
    lengths.set(e.sha256, e.bytes);
    seen.add(key);
    bytes += e.bytes;
  }
  if (!Number.isSafeInteger(bytes)) throw Error("Invalid object staging size");
  const core = {
    schemaVersion: 1 as const,
    entries: sorted,
    files: sorted.length,
    bytes,
  };
  return {
    ...core,
    sha256: createHash("sha256").update(JSON.stringify(core)).digest("hex"),
  };
}
async function directory(path: string): Promise<void> {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  )
    throw Error("Staging root must be a real directory");
}
async function existing(
  path: string,
  entry: MigrationObjectStageEntry,
): Promise<boolean> {
  try {
    await verifyMediaBytes(path, entry.bytes, entry.sha256);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
/** Operator only: stage verified immutable bytes; never connects to a database or network. */
export async function stageMigrationObjects(
  plan: MigrationObjectStagePlan,
  options: {
    sourceDirectory: string;
    targetRoot: string;
    uid: number;
    gid: number;
    expectedPlanSha256: string;
  },
): Promise<MigrationObjectStageReceipt> {
  const expected = createMigrationObjectStagePlan(plan.entries);
  if (
    JSON.stringify(plan) !== JSON.stringify(expected) ||
    plan.sha256 !== options.expectedPlanSha256
  )
    throw Error("Object staging manifest differs from approved digest");
  if (
    !Number.isSafeInteger(options.uid) ||
    options.uid < 0 ||
    !Number.isSafeInteger(options.gid) ||
    options.gid < 0
  )
    throw Error("Invalid runtime identity");
  const source = resolve(options.sourceDirectory),
    root = resolve(options.targetRoot);
  if (
    source === root ||
    source.startsWith(root + "/") ||
    root.startsWith(source + "/")
  )
    throw Error("Source and target roots must be separate");
  await directory(source);
  await directory(root);
  // Check every source and every existing destination before creating or changing target paths.
  const seen = new Set<string>();
  for (const e of plan.entries) {
    if (!seen.has(e.sha256)) {
      await verifyMediaBytes(join(source, e.sha256), e.bytes, e.sha256);
      seen.add(e.sha256);
    }
    const dir = join(root, e.store);
    try {
      await directory(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await existing(join(dir, e.sha256), e);
  }
  for (const store of new Set(plan.entries.map((e) => e.store))) {
    const path = join(root, store);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await directory(path);
    await chown(path, options.uid, options.gid);
    await chmod(path, 0o700);
  }
  const result = {
    planSha256: plan.sha256,
    files: plan.files,
    bytes: plan.bytes,
    created: 0,
    reused: 0,
  };
  for (const e of plan.entries) {
    const target = join(root, e.store, e.sha256);
    if (await existing(target, e)) {
      await chown(target, options.uid, options.gid);
      await chmod(target, 0o600);
      result.reused++;
      continue;
    }
    const temporary = join(root, e.store, ".stage-" + randomUUID());
    const file = await open(temporary, "wx", 0o600);
    try {
      await verifyMediaBytes(join(source, e.sha256), e.bytes, e.sha256, file);
      await file.chown(options.uid, options.gid);
      await file.sync();
      await file.close();
      try {
        await link(temporary, target);
        result.created++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await verifyMediaBytes(target, e.bytes, e.sha256);
        result.reused++;
      }
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary);
    }
  }
  // Receipt means the complete target set has just been checked, even on a resumed run.
  for (const e of plan.entries) {
    const path = join(root, e.store, e.sha256);
    await verifyMediaBytes(path, e.bytes, e.sha256);
    const info = await lstat(path);
    if (
      info.uid !== options.uid ||
      info.gid !== options.gid ||
      (info.mode & 0o777) !== 0o600
    )
      throw Error("Staged runtime permissions differ");
  }
  return result;
}
