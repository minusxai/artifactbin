import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createDatasetAttachmentStorage } from "../src/persistence/dataset-attachment-storage.ts";
import type { ImageProcessor } from "../src/datasets/attachments/image-processor-contracts.ts";
const png = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001",
  "hex",
);
function processor(): ImageProcessor {
  return {
    async process(source) {
      const data = await readFile(source.path);
      return {
        primary: {
          ...source,
          sha256: createHash("sha256").update(data).digest("hex"),
        },
        totalBytes: data.length,
        width: 1,
        height: 1,
        placeholder: null,
        dispose: async () => {},
      };
    },
    close: async () => {},
  };
}
test("staging does not publish bytes before quota admission; immutable publish survives request discard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attachments-"));
  try {
    const storage = createDatasetAttachmentStorage({
      directory,
      processor: processor(),
    });
    const staged = await storage.stage({
      requestId: "request_123",
      filename: "image.png",
      contentType: "image/png",
      body: (async function* () {
        yield png.subarray(0, 4);
        yield png.subarray(4);
      })(),
    });
    assert.equal((await readdir(join(directory, "objects"))).length, 0);
    await staged.publish();
    await staged.publish();
    await staged.discard();
    const opened = await storage.open(staged.object);
    const chunks = [];
    for await (const c of opened.body) chunks.push(c);
    await opened.close();
    assert.deepEqual(Buffer.concat(chunks), png);
    assert.equal((await readdir(join(directory, "staging"))).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("actual streamed overflow rejects before processor and cleans staging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attachments-"));
  try {
    let calls = 0;
    const p = processor();
    p.process = async () => {
      calls++;
      throw new Error("unexpected");
    };
    const storage = createDatasetAttachmentStorage({ directory, processor: p });
    await assert.rejects(
      storage.stage({
        requestId: "request_123",
        filename: "image.png",
        contentType: "image/png",
        body: (async function* () {
          for (let i = 0; i < 51; i++) yield new Uint8Array(1_000_000);
        })(),
      }),
      { code: "too_large" },
    );
    assert.equal(calls, 0);
    assert.equal((await readdir(join(directory, "staging"))).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("declared image type cannot hide another payload and no decoder receives it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attachments-"));
  try {
    let calls = 0;
    const p = processor();
    p.process = async () => {
      calls++;
      throw new Error("unexpected");
    };
    const storage = createDatasetAttachmentStorage({ directory, processor: p });
    await assert.rejects(
      storage.stage({
        requestId: "request_123",
        filename: "x.png",
        contentType: "image/png",
        body: (async function* () {
          yield Buffer.from("<svg></svg>");
        })(),
      }),
      { code: "invalid_request" },
    );
    assert.equal(calls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("failed processor output cleanup stops future staging without republishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attachments-"));
  try {
    const p = processor(),
      process = p.process;
    let calls = 0;
    p.process = async (...args) => {
      calls++;
      return {
        ...(await process(...args)),
        dispose: async () => {
          throw Error("cleanup failed");
        },
      };
    };
    const storage = createDatasetAttachmentStorage({ directory, processor: p });
    const upload = () => ({
      requestId: "request_123",
      filename: "image.png",
      contentType: "image/png" as const,
      body: (async function* () {
        yield png;
      })(),
    });
    await assert.rejects(storage.stage(upload()), /cleanup failed/);
    await assert.rejects(storage.stage(upload()), { code: "unavailable" });
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(join(directory, "objects")), []);
    assert.deepEqual(await readdir(join(directory, "staging")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
