import test from "node:test";
import assert from "node:assert/strict";
import { optimiseRaster } from "../src/media/image-processing/engine.ts";
import type { RasterDecoder } from "../src/media/image-processing/contracts.ts";
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(1000),
]);
function decoder(width = 2000, height = 1000): RasterDecoder {
  return {
    metadata: async () => ({ width, height, pages: 1 }),
    encode: async (_input, op) => ({
      bytes: Buffer.alloc(
        op === "primary-png" ? 500 : op === "small" ? 100 : 20,
      ),
      width: op === "small" ? 1280 : op === "placeholder" ? 16 : 2000,
      height: op === "small" ? 640 : op === "placeholder" ? 8 : 1000,
    }),
  };
}
test("frozen selection keeps strictly smaller main, source-width variant threshold and separate placeholder", async () => {
  const out = await optimiseRaster(png, decoder());
  assert.equal(out.manifest.primary.source, "encoded");
  assert.equal(out.manifest.primary.contentType, "image/webp");
  assert.equal(out.manifest.small?.width, 1280);
  assert.match(out.manifest.placeholder!, /^data:image\/webp;base64,/);
  const narrow = await optimiseRaster(png, decoder(1536, 768));
  assert.equal(narrow.small, null);
});
test("larger encoding keeps original MIME/dimensions but smaller variant compares against served original", async () => {
  const d = decoder();
  const encode = d.encode;
  d.encode = async (i, op) =>
    op === "primary-png"
      ? { bytes: Buffer.alloc(png.length), width: 2048, height: 1024 }
      : encode(i, op);
  const out = await optimiseRaster(png, d);
  assert.equal(out.primary, null);
  assert.equal(out.manifest.primary.source, "input");
  assert.equal(out.manifest.primary.contentType, "image/png");
  assert.equal(out.manifest.primary.width, 2000);
  assert.equal(out.small?.length, 100);
});
test("animation and decode failure preserve input without frame encoding; resource limits refuse explicitly", async () => {
  const d = decoder();
  let calls = 0;
  d.metadata = async () => ({ width: 2000, height: 1000, pages: 2 });
  d.encode = async () => {
    calls++;
    throw Error();
  };
  assert.equal((await optimiseRaster(png, d)).manifest.primary.source, "input");
  assert.equal(calls, 0);
  d.metadata = async () => {
    throw Error("image_decode_failed");
  };
  assert.equal((await optimiseRaster(png, d)).manifest.primary.width, null);
  d.metadata = async () => ({ width: 10000, height: 10000, pages: 1 });
  await assert.rejects(optimiseRaster(png, d), /image_pixel_limit/);
});
test("failed main encoding preserves original; optional failures do not discard usable primary", async () => {
  const d = decoder();
  d.encode = async () => {
    throw Error("image_decode_failed");
  };
  const original = await optimiseRaster(png, d);
  assert.equal(original.primary, null);
  assert.equal(original.manifest.placeholder, null);
  assert.equal(original.small, null);
  const encode = decoder().encode;
  d.encode = async (i, op) =>
    op === "primary-png"
      ? encode(i, op)
      : Promise.reject(Error("image_decode_failed"));
  const encoded = await optimiseRaster(png, d);
  assert.equal(encoded.manifest.primary.source, "encoded");
  assert.equal(encoded.manifest.placeholder, null);
});
test("empty, excessive and unsupported signatures are refused before any decoder call", async () => {
  const d = decoder();
  d.metadata = async () => {
    throw Error("must not decode");
  };
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("<svg/>"),
    Buffer.alloc(50_000_001),
  ])
    await assert.rejects(optimiseRaster(bytes, d), /image_(input_limit|type)/);
});
test("untrusted binary manifest cannot enlarge original, forge MIME or add file paths/options", async () => {
  const { decodeImageManifest } = await import(
    "../src/media/image-processing/protocol.ts"
  );
  const good = (await optimiseRaster(png, decoder())).manifest;
  assert.deepEqual(decodeImageManifest(good, png.length, "image/png"), good);
  for (const changed of [
    { ...good, path: "/private" },
    { ...good, sourceType: "image/jpeg" },
    { ...good, primary: { ...good.primary, byteLength: png.length } },
    { ...good, primary: { ...good.primary, width: 99999 } },
    { ...good, small: { ...good.small, byteLength: good.primary.byteLength } },
  ])
    assert.throws(
      () => decodeImageManifest(changed, png.length, "image/png"),
      /image_result_invalid/,
    );
  assert.throws(
    () =>
      decodeImageManifest(
        { error: "image_pixel_limit" },
        png.length,
        "image/png",
      ),
    /image_pixel_limit/,
  );
});
test("fixed image job has no network, mounts, credentials or caller command selection", async () => {
  const { imageDockerArguments } = await import(
    "../src/media/image-processing/executor.ts"
  );
  const args = imageDockerArguments(
    "fixed-name",
    "sha256:" + "a".repeat(64),
    "test.backend=1",
  );
  for (const flag of [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=1",
    "--pids-limit=32",
    "--user=10001:10001",
  ])
    assert.ok(args.includes(flag));
  assert.equal(
    args.some(
      (x) => x === "--mount" || x === "-v" || x === "-e" || x === "--env",
    ),
    false,
  );
  assert.equal(args.at(-1), "sha256:" + "a".repeat(64));
});

test("resource and unknown native failures never become successful passthrough", async () => {
  const d = decoder();
  for (const code of [
    "image_pixel_limit",
    "image_processing_failed",
    "out of memory",
  ]) {
    d.metadata = async () => {
      throw Error(code);
    };
    await assert.rejects(optimiseRaster(png, d));
  }
  d.metadata = decoder().metadata;
  d.encode = async () => {
    throw Error("image_processing_failed");
  };
  await assert.rejects(optimiseRaster(png, d), /image_processing_failed/);
});
