/**
 * THE SCHEMA IMAGE ON DISK, so a fresh worker restores a database instead of running initdb and the boot DDL (~660ms
 * locally, of which initdb is ~540ms; ~170ms restored). One file per image, named by `schemaImageKey`
 * (lib/platform/db): the key is a hash over the statements boot runs and the PGLite that runs them, so a file built
 * from any other schema or engine is never read. CI keeps the directory in its test-builds cache (pr-fast.yml,
 * ci.yml); whatever an entry holds, only the file named by this checkout's key loads.
 *
 * Workers race to write it: each writes a private temporary file and renames it into place, an atomic replace on one
 * filesystem, so a reader sees no file or a whole one. Images under any other key are removed after a write, so the
 * directory (and the cache entry that carries it) holds one image, not one per schema the branch has seen.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

declare module 'vitest' {
  interface ProvidedContext { schemaImageDir?: string }
}

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_schema_image_writes__: Promise<void>[] | undefined;
}

const IMAGE = /^[0-9a-f]{32}\.tar$/;

export const schemaImageFile = (dir: string, key: string): string => path.join(dir, `${key}.tar`);

/** The image stored under `key`, or undefined when there is none (or it cannot be read). */
export function readSchemaImage(dir: string, key: string): Blob | undefined {
  try {
    return new Blob([readFileSync(schemaImageFile(dir, key))]);
  } catch {
    return undefined;
  }
}

/** Store `image` under `key` atomically, then drop images stored under any other key. */
export async function writeSchemaImage(dir: string, key: string, image: Blob): Promise<void> {
  const bytes = Buffer.from(await image.arrayBuffer());
  mkdirSync(dir, { recursive: true });
  const file = schemaImageFile(dir, key);
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.partial`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  for (const name of readdirSync(dir)) if (IMAGE.test(name) && name !== `${key}.tar`) rmSync(path.join(dir, name), { force: true });
}

/** Start a write that `schemaImageWrites` will wait for, so a worker never exits with its image half written. */
export function queueSchemaImageWrite(dir: string, key: string, image: Blob): void {
  const writes = (globalThis.__artifact_bin_schema_image_writes__ ??= []);
  // A failed write only costs the next worker its own boot.
  writes.push(writeSchemaImage(dir, key, image).catch(() => undefined));
}

/** Every write this process has queued, settled. */
export async function schemaImageWrites(): Promise<void> {
  await Promise.all(globalThis.__artifact_bin_schema_image_writes__ ?? []);
}
