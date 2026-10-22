import type { ArchivedLocalOutput } from "../src/migration/conversion/compiled/local-contracts.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { decodeCompiledJavascript } from "../src/migration/conversion/compiled/javascript-payload-decode.ts";
import { startCompiledPayload } from "../src/migration/conversion/compiled/javascript-payload-lifecycle.ts";
const payload = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  return {
    compression: "gzip" as const,
    base64: gzipSync(bytes).toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uncompressedBytes: bytes.length,
  };
};
test("generated module bytes round-trip Unicode exactly; malformed, corrupt, truncated, digest/length and UTF8 mismatches fail closed", async () => {
  const source = 'export const label="Text ☃";\n';
  const valid = payload(source);
  assert.equal(await decodeCompiledJavascript(valid), source);
  for (const bad of [
    { ...valid, unexpected: true },
    { ...valid, compression: "br" },
    { ...valid, base64: "?" },
    { ...valid, base64: valid.base64.slice(4) },
    { ...valid, sha256: "0".repeat(64) },
    { ...valid, uncompressedBytes: valid.uncompressedBytes - 1 },
    { ...valid, uncompressedBytes: valid.uncompressedBytes + 1 },
    { ...valid, uncompressedBytes: 32 * 1024 * 1024 + 1 },
    payload(new Uint8Array([255])),
  ])
    await assert.rejects(decodeCompiledJavascript(bad as any));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    decodeCompiledJavascript(valid, controller.signal),
    /cancel/i,
  );
});
test("packed bounds, trailing streams and cancellation during expansion fail closed", async () => {
  const valid = payload("export {};");
  for (const trailing of [Buffer.from("trailing"), gzipSync("")])
    await assert.rejects(
      decodeCompiledJavascript({
        ...valid,
        base64: Buffer.concat([
          Buffer.from(valid.base64, "base64"),
          trailing,
        ]).toString("base64"),
      }),
    );
  await assert.rejects(
    decodeCompiledJavascript({
      ...valid,
      base64: "A".repeat(4 * 1024 * 1024 + 4),
    }),
  );
  await assert.rejects(
    decodeCompiledJavascript({
      ...payload("x".repeat(1024 * 1024)),
      uncompressedBytes: 1,
    }),
  );
  const original = globalThis.DecompressionStream,
    controller = new AbortController();
  try {
    globalThis.DecompressionStream = class {
      constructor() {
        return new TransformStream({
          transform(_chunk, output) {
            output.enqueue(new Uint8Array([120]));
            controller.abort();
          },
        });
      }
    } as any;
    await assert.rejects(
      decodeCompiledJavascript(valid, controller.signal),
      /cancel/i,
    );
  } finally {
    globalThis.DecompressionStream = original;
  }
});
test("loader owns one module and URL lifetime; errors are visible once and never execute rejected bytes", async () => {
  const calls: string[] = [];
  const ports = {
    decode: async () => "export {};",
    createURL: () => {
      calls.push("create");
      return "blob:owned";
    },
    revokeURL: () => {
      calls.push("revoke");
    },
    importModule: async () => {
      calls.push("import");
    },
    error: () => {
      calls.push("error");
    },
  };
  await startCompiledPayload(ports).settled;
  assert.deepEqual(calls, ["create", "import", "revoke"]);
  calls.length = 0;
  await startCompiledPayload({
    ...ports,
    decode: async () => {
      throw Error("Corrupt");
    },
  }).settled;
  assert.deepEqual(calls, ["error"]);
  calls.length = 0;
  await startCompiledPayload({
    ...ports,
    importModule: async () => {
      calls.push("import");
      throw Error("CSP");
    },
  }).settled;
  assert.deepEqual(calls, ["create", "import", "error", "revoke"]);
});
test("pagehide releases an in-flight import once; BFCache does not start a second module", async () => {
  let finish!: () => void,
    imported = 0,
    revoked = 0,
    errors = 0;
  const loader = startCompiledPayload({
    decode: async () => "export {};",
    createURL: () => "blob:owned",
    revokeURL: () => {
      revoked++;
    },
    importModule: () => {
      imported++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    error: () => {
      errors++;
    },
  });
  await Promise.resolve();
  loader.pagehide(true);
  assert.equal(revoked, 0);
  assert.equal(imported, 1);
  loader.pagehide(false);
  assert.equal(revoked, 1);
  finish();
  await loader.settled;
  loader.pagehide(false);
  assert.deepEqual(
    { imported, revoked, errors },
    { imported: 1, revoked: 1, errors: 0 },
  );
});
test("retired documents cannot import late decoded bytes; BFCache preserves the same pending boot and URL revocation is exact", async () => {
  for (const persisted of [false, true]) {
    let resolve!: (source: string) => void;
    let signal!: AbortSignal;
    let imported = 0,
      revoked = 0,
      errors = 0;
    const loader = startCompiledPayload({
      decode: (s) => {
        signal = s;
        return new Promise((r) => (resolve = r));
      },
      createURL: () => "blob:owned",
      revokeURL: () => revoked++,
      importModule: async () => {
        imported++;
      },
      error: () => errors++,
    });
    loader.pagehide(persisted);
    assert.equal(signal.aborted, !persisted);
    resolve("export {};");
    await loader.settled;
    loader.pagehide(false);
    loader.pagehide(false);
    assert.equal(imported, persisted ? 1 : 0);
    assert.equal(revoked, persisted ? 1 : 0);
    assert.equal(errors, 0);
  }
});

import { compiledJavascriptMarkup } from "../src/migration/conversion/compiled/javascript-payload.ts";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
test("packaging preserves raw small modules and readable HTML/state; decoded policy admission still precedes compression and the final 4MB cap", async () => {
  const base: Omit<ArchivedLocalOutput, "javascript"> = {
    html: '<p id="content">Readable content</p>',
    css: "p { color: blue }",
    title: "Proof",
    build: "fixture",
    rootAttributes: {},
    declarations: [{ name: "label", type: "string", default: "Saved text" }],
    modules: [],
    capabilities: [],
  };
  const source =
      '<Helmet><Value name="label" type="string" default="Saved text"/></Helmet><p id="content">Readable content</p>',
    javascript = "const generated=" + JSON.stringify("x".repeat(4000000)) + ";";
  const result = await compileArchivedLocal(
    { source, coreUrl: "/af/v1/core.js" },
    { compiler: { compile: async () => ({ ...base, javascript }) } },
  );
  assert.equal(
    result.classification,
    "functional",
    JSON.stringify(result.issues),
  );
  assert.ok(result.html && Buffer.byteLength(result.html) < 4000000);
  assert.match(result.html!, /<p id="content"[^>]*>Readable content<\/p>/);
  assert.match(result.html!, /p \{ color: blue \}/);
  assert.match(result.html!, /data-af="state"/);
  assert.match(result.html!, /data-af-compiled-payload/);
  const denied = await compileArchivedLocal(
    { source, coreUrl: "/af/v1/core.js" },
    {
      compiler: {
        compile: async () => ({
          ...base,
          javascript: javascript + 'const disallowed="/api/private";',
        }),
      },
    },
  );
  assert.equal(denied.classification, "manual-blocked");
  assert.equal(denied.html, null);
  assert.equal(
    compiledJavascriptMarkup("export {};"),
    '<script type="module">export {};</script>',
  );
  const tooMuchHtml = await compileArchivedLocal(
    { source, coreUrl: "/af/v1/core.js" },
    {
      compiler: {
        compile: async () => ({
          ...base,
          css: "/*" + "x".repeat(4000000) + "*/",
          javascript,
        }),
      },
    },
  );
  assert.equal(tooMuchHtml.classification, "manual-blocked");
  assert.equal(tooMuchHtml.issues[0]?.code, "compiled-page-limit");
});
