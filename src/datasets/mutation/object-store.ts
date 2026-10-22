import { constants } from "node:fs";
import { lstat, open, link, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadonlyDatasetObjectStore } from "../object-store.ts";
import type { DatasetObjectStore } from "../object-store-contracts.ts";
import type { DatasetMutationObjectStore } from "./repository-contracts.ts";
import {
  DATASET_SQL_LIMITS as limits,
  DatasetMutationError,
} from "./contracts.ts";
/** Staging may leave an unreferenced immutable object after a crash; no DB head
 * points to bytes before the file and directory entry are durable. */
export function createDatasetMutationObjectStore(
  directory: string,
  fallback?: DatasetObjectStore,
): DatasetMutationObjectStore {
  const root = resolve(directory),
    reader = createReadonlyDatasetObjectStore(root);
  return {
    async read(key, signal) {
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new DatasetMutationError("invalid_object");
      try {
        await lstat(join(root, key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && fallback)
          return fallback.read(key, signal);
        throw error;
      }
      return reader.read(key, signal);
    },
    async persist(rows) {
      const invalid = (): never => {
        throw new DatasetMutationError("invalid_object");
      };
      if (!Array.isArray(rows) || rows.length > limits.maxRows) invalid();
      let cells = 0,
        size = 2;
      const encoded: string[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) invalid();
        for (const [key, value] of Object.entries(row)) {
          if (
            ++cells > limits.maxCells ||
            key.includes("\0") ||
            !(
              value === null ||
              typeof value === "string" ||
              typeof value === "boolean" ||
              (typeof value === "number" && Number.isFinite(value))
            ) ||
            (typeof value === "string" &&
              Buffer.byteLength(value) > limits.outputBytes)
          )
            invalid();
        }
        const text = JSON.stringify(row);
        size += Buffer.byteLength(text) + (encoded.length ? 1 : 0);
        if (size > limits.outputBytes) invalid();
        encoded.push(text);
      }
      const bytes = Buffer.from("[" + encoded.join(",") + "]"),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) invalid();
      const temporary = join(root, ".mutation-" + randomUUID()),
        target = join(root, sha256);
      let created = false;
      const file = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o640,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
        await file.close();
        try {
          await link(temporary, target);
          created = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        // Existing objects are independently validated: never trust a hash-shaped name.
        if (!created) {
          const existing = await open(
            target,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            const stat = await existing.stat();
            if (!stat.isFile() || stat.size !== bytes.length) invalid();
            if (!(await existing.readFile()).equals(bytes)) invalid();
          } finally {
            await existing.close();
          }
        }
        await unlink(temporary);
        const directoryHandle = await open(
          root,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
        return { key: sha256, sha256, bytes: bytes.length };
      } finally {
        await file.close().catch(() => {});
        await unlink(temporary).catch(() => {});
      }
    },
  };
}
