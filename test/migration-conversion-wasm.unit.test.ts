import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { decodeCompiledWasm } from "../src/migration/conversion/compiled/wasm.ts";
const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const pack = (data = bytes) => ({
  compression: "gzip" as const,
  base64: gzipSync(data).toString("base64"),
  sha256: createHash("sha256").update(data).digest("hex"),
  uncompressedBytes: data.length,
});
test("bounded embedded gzip decodes exact authenticated WASM bytes", async () => {
  const actual = await decodeCompiledWasm(pack());
  assert.deepEqual(actual, bytes);
  await WebAssembly.compile(actual);
});
test("embedded WASM refuses malformed metadata, corrupt/truncated gzip, wrong digest and expansion beyond declared cap", async () => {
  for (const payload of [
    { ...pack(), compression: "br" },
    { ...pack(), base64: "!notbase64" },
    { ...pack(), sha256: "a".repeat(64) },
    { ...pack(), uncompressedBytes: 1 },
    { ...pack(), uncompressedBytes: 2097153 },
    { ...pack(), base64: pack().base64.slice(0, -8) },
    { ...pack(), base64: "A".repeat(1500000) },
    pack(new Uint8Array(2097153)),
  ])
    await assert.rejects(decodeCompiledWasm(payload as any));
});
