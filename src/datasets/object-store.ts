import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { DATASET_OBJECT_BYTES, DatasetReadError } from "./contracts.ts";
import type { DatasetObjectStore } from "./object-store-contracts.ts";
/** The configured root is a dedicated read-only mount; only flat full-SHA object names are admitted. */
export function createReadonlyDatasetObjectStore(
  directory: string,
): DatasetObjectStore {
  const root = resolve(directory);
  return {
    async read(key, signal) {
      signal?.throwIfAborted();
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new DatasetReadError("invalid_dataset");
      let handle;
      try {
        handle = await open(
          resolve(root, key),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > DATASET_OBJECT_BYTES)
          throw new DatasetReadError("invalid_dataset");
      } catch {
        await handle?.close();
        throw new DatasetReadError("invalid_dataset");
      }
      const file = handle;
      return (async function* () {
        try {
          for await (const chunk of file.createReadStream({
            autoClose: false,
          })) {
            signal?.throwIfAborted();
            yield chunk as Buffer;
          }
        } finally {
          await file.close();
        }
      })();
    },
  };
}
