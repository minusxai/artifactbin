import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import { chromium, webkit } from "playwright";
import { decodeCompiledWasm } from "../src/migration/conversion/compiled/wasm.ts";
for (const [name, engine] of Object.entries({ chromium, webkit }))
  test(`embedded engine codec verifies and instantiates through ${name}`, async () => {
    const custom = randomBytes(600000);
    let sectionLength = custom.length + 1;
    const leb: number[] = [];
    do {
      let byte = sectionLength & 127;
      sectionLength >>>= 7;
      if (sectionLength) byte |= 128;
      leb.push(byte);
    } while (sectionLength);
    const bytes = Uint8Array.from([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      0,
      ...leb,
      0,
      ...custom,
    ]);
    const payload = {
      compression: "gzip",
      base64: gzipSync(bytes).toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uncompressedBytes: bytes.length,
    };
    const server = createServer((_, r) =>
      r.end("<!doctype html><title>Codec proof</title>"),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
      const answer = await page.evaluate(
        async ({ source, payload }) => {
          const decode = (0, eval)(
            "(()=>{const __name=f=>f;return " + source + "})()",
          );
          const bytes = await decode(payload);
          await WebAssembly.instantiate(bytes);
          let rejected = false;
          try {
            await decode({ ...payload, sha256: "0".repeat(64) });
          } catch {
            rejected = true;
          }
          return { length: bytes.length, rejected };
        },
        { source: decodeCompiledWasm.toString(), payload },
      );
      assert.deepEqual(answer, { length: bytes.length, rejected: true });
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
