import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MediaStore, MediaRange } from "./contracts.ts";
/** Operator-staged immutable flat objects. No storage credentials or write operations exist here. */
export function readOnlyMediaStore(directory?: string): MediaStore {
  const root = directory ? resolve(directory) : null;
  return {
    async open(descriptor) {
      if (
        !root ||
        !/^[a-f0-9]{64}$/.test(descriptor.storageKey) ||
        descriptor.storageKey !== descriptor.sha256 ||
        !Number.isSafeInteger(descriptor.byteLength) ||
        descriptor.byteLength < 0
      )
        throw new Error("Media unavailable");
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Media unavailable");
      const file = await open(
        join(root, descriptor.storageKey),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size !== descriptor.byteLength)
          throw new Error("Media unavailable");
      } catch {
        await file.close();
        throw new Error("Media unavailable");
      }
      let closed = false;
      return {
        stream(range?: MediaRange) {
          if (closed) throw new Error("Media unavailable");
          return file.createReadStream({
            autoClose: false,
            ...(range ? { start: range.start, end: range.end } : {}),
          });
        },
        async close() {
          if (!closed) {
            closed = true;
            await file.close();
          }
        },
      };
    },
  };
}
