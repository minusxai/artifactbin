import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { remoteImageProcessor } from "../src/media/image-processing/remote.ts";
import { imageProcessingListener } from "../src/media/image-processing/listener.ts";
import { imageHeader } from "../src/media/image-processing/protocol.ts";
import type {
  ImageJobExecutor,
  ImageManifest,
} from "../src/media/image-processing/contracts.ts";
const secret = "test-image-controller-secret-123456789";
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(100),
]);
const webp = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBP"),
  Buffer.alloc(8),
]);
function manifest(): ImageManifest {
  return {
    version: "image-process-v1",
    sourceType: "image/png",
    primary: {
      source: "encoded",
      contentType: "image/webp",
      byteLength: webp.length,
      width: 2,
      height: 2,
    },
    small: null,
    placeholder: null,
  };
}
async function setup(executor: ImageJobExecutor) {
  const listener = imageProcessingListener(executor, secret),
    server = createServer(listener);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const processor = remoteImageProcessor({
    endpoint: `http://127.0.0.1:${address.port}`,
    secret,
  });
  return {
    processor,
    async close() {
      await processor.close();
      await listener.close();
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    },
  };
}
test("streams bounded bytes, hashes generated output and dispose preserves caller input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "image-test-"));
  let received = 0;
  const host = await setup({
    async execute(input, write) {
      for await (const chunk of input) received += chunk.length;
      await write(imageHeader(manifest()));
      for (const byte of webp) await write(Buffer.from([byte]));
    },
    async close() {},
  });
  try {
    const path = join(dir, "input");
    await writeFile(path, png);
    const result = await host.processor.process({
      path,
      byteLength: png.length,
      contentType: "image/png",
    });
    assert.equal(received, png.length);
    assert.equal(result.totalBytes, webp.length);
    assert.match(result.primary.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readFile(result.primary.path), webp);
    await result.dispose();
    assert.deepEqual(await readFile(path), png);
    await assert.rejects(readFile(result.primary.path), { code: "ENOENT" });
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("refuses symlink and length disagreement before controller receives bytes", async () => {
  let calls = 0;
  const host = await setup({
    async execute() {
      calls++;
    },
    async close() {},
  });
  const dir = await mkdtemp(join(tmpdir(), "image-test-"));
  try {
    const path = join(dir, "input");
    await writeFile(path, png);
    await symlink(path, join(dir, "link"));
    await assert.rejects(
      host.processor.process({
        path: join(dir, "link"),
        byteLength: png.length,
        contentType: "image/png",
      }),
    );
    await assert.rejects(
      host.processor.process({
        path,
        byteLength: png.length - 1,
        contentType: "image/png",
      }),
      /image_input_changed/,
    );
    assert.equal(calls, 0);
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("malformed lengths, trailing bytes and output MIME disagreement are refused", async () => {
  for (const mode of ["length", "trailing", "mime"]) {
    const host = await setup({
      async execute(input, write) {
        for await (const _ of input) {
        }
        if (mode === "length") {
          await write(Buffer.from([255, 255, 255, 255]));
          return;
        }
        await write(imageHeader(manifest()));
        await write(mode === "mime" ? Buffer.alloc(webp.length) : webp);
        if (mode === "trailing") await write(Buffer.from([1]));
      },
      async close() {},
    });
    const dir = await mkdtemp(join(tmpdir(), "image-test-"));
    try {
      const path = join(dir, "input");
      await writeFile(path, png);
      await assert.rejects(
        host.processor.process({
          path,
          byteLength: png.length,
          contentType: "image/png",
        }),
        /image_result/,
      );
    } finally {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});
test("abort preserves admission until owned cleanup settles and permits no queued work", async () => {
  let started!: () => void;
  const entered = new Promise<void>((r) => (started = r));
  let cleaned!: () => void;
  const cleanup = new Promise<void>((r) => (cleaned = r));
  let calls = 0;
  const host = await setup({
    async execute(input, _write, signal) {
      calls++;
      for await (const _ of input) {
      }
      started();
      await new Promise<void>((r) =>
        signal!.addEventListener("abort", () => r(), { once: true }),
      );
      await cleanup;
      throw Error("cancelled");
    },
    async close() {},
  });
  const dir = await mkdtemp(join(tmpdir(), "image-test-"));
  const controller = new AbortController();
  try {
    const path = join(dir, "input");
    await writeFile(path, png);
    const pending = host.processor.process(
      { path, byteLength: png.length, contentType: "image/png" },
      controller.signal,
    );
    await entered;
    controller.abort();
    await assert.rejects(pending);
    const second = host.processor.process({
      path,
      byteLength: png.length,
      contentType: "image/png",
    });
    await assert.rejects(second, /image_unavailable/);
    assert.equal(calls, 1);
    cleaned();
  } finally {
    cleaned();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
