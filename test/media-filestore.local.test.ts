import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOnlyMediaStore } from "../src/media/filestore.ts";
import type { MediaDescriptor } from "../src/media/contracts.ts";
const descriptor: MediaDescriptor = {
  pageId: "ABC123",
  revision: "1",
  variant: "original",
  sha256: "a".repeat(64),
  storageKey: "a".repeat(64),
  contentType: "image/png",
  filename: null,
  byteLength: 4,
};
test("read-only filestore streams exact bytes and ranges while rejecting paths, links and size drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "media-store-"));
  try {
    const bytes = Buffer.from([0, 255, 1, 2]);
    await writeFile(join(root, descriptor.sha256), bytes, { mode: 0o600 });
    const store = readOnlyMediaStore(root);
    const object = await store.open(descriptor);
    assert.deepEqual(
      Buffer.concat(await collect(object.stream({ start: 1, end: 2 }))),
      bytes.subarray(1, 3),
    );
    await object.close();
    await assert.rejects(
      store.open({ ...descriptor, storageKey: "../secret" }),
    );
    await assert.rejects(store.open({ ...descriptor, byteLength: 5 }));
    await rm(join(root, descriptor.sha256));
    await symlink(join(root, "private"), join(root, descriptor.sha256));
    await assert.rejects(store.open(descriptor));
    await rm(join(root, descriptor.sha256));
    await mkdir(join(root, descriptor.sha256));
    await assert.rejects(store.open(descriptor));
    await assert.rejects(readOnlyMediaStore().open(descriptor));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function collect(
  source: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}
