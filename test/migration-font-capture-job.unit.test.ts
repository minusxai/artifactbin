import { test } from "node:test";
import assert from "node:assert/strict";
import { captureFontJob } from "../src/migration/conversion/compiled/fonts/capture.ts";
const url =
    "https://fonts.googleapis.com/css2?family=Example:wght@400&display=swap",
  css = `@font-face{font-family:'Example';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/example/v1/a.woff2) format('woff2');unicode-range:U+0000-00FF}`;
function ports() {
  let time = 0,
    scheduled = () => {},
    cancelled = false;
  const bytes = Buffer.alloc(52);
  bytes.write("wOF2");
  bytes.writeUInt32BE(0x10000, 4);
  bytes.writeUInt16BE(1, 12);
  bytes.writeUInt32BE(2, 20);
  bytes[48] = 0;
  bytes[49] = 100;
  bytes.writeUInt32BE(52, 8);
  bytes.writeUInt32BE(128, 16);
  return {
    clock: {
      advance: () => (time = 30_000),
      expire: () => scheduled(),
      cancelled: () => cancelled,
    },
    value: {
      fetch: async (_url: string, kind: string) =>
        kind === "stylesheet" ? Buffer.from(css) : bytes,
      inspect: async () => ({
        families: ["Example"],
        axes: [],
        weight: 400,
        style: "normal" as const,
      }),
      now: () => time,
      schedule: (callback: () => void) => {
        scheduled = callback;
        return () => (cancelled = true);
      },
    },
  };
}
test("capture receipts cover exact original stylesheet and font bytes without filesystem writes", async () => {
  const p = ports(),
    job = await captureFontJob([url], p.value);
  assert.equal(job.manifest.stylesheets.length, 1);
  assert.equal(job.files.size, 2);
  assert.equal(job.manifest.stylesheets[0]?.faces[0]?.bytes, 52);
  assert(p.clock.cancelled());
});
test("one overall capture deadline cancels held resource work and prevents follow-on requests", async () => {
  const p = ports();
  let calls = 0;
  p.value.fetch = async () => {
    calls++;
    p.clock.advance();
    return Buffer.from(css);
  };
  await assert.rejects(() => captureFontJob([url], p.value));
  assert.equal(calls, 1);
  const held = ports();
  held.value.fetch = () => new Promise(() => {});
  const promise = captureFontJob([url], held.value);
  held.clock.expire();
  await assert.rejects(() => promise);
  assert(held.clock.cancelled());
});
test("capture budgets count aggregate faces and bytes across the entire job", async () => {
  const many = ports();
  const baseCss = Buffer.from(
    await many.value.fetch(url, "stylesheet"),
  ).toString();
  let inspected = 0;
  const bytes = Buffer.alloc(2_000_000);
  bytes.write("wOF2");
  bytes.writeUInt32BE(0x10000, 4);
  bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt16BE(1, 12);
  bytes.writeUInt32BE(128, 16);
  bytes.writeUInt32BE(2, 20);
  bytes[49] = 100;
  many.value.fetch = async (_url, kind) =>
    kind === "stylesheet" ? Buffer.from(baseCss.repeat(5)) : bytes;
  many.value.inspect = async () => {
    inspected++;
    return { families: ["Example"], axes: [], weight: 400, style: "normal" };
  };
  await assert.rejects(() => captureFontJob([url], many.value));
  assert.equal(inspected, 4);
  await assert.rejects(() =>
    captureFontJob(
      Array.from({ length: 9 }, (_, i) => url + "&extra=" + i),
      ports().value,
    ),
  );
  const faces = ports();
  faces.value.fetch = async (_url, kind) =>
    kind === "stylesheet" ? Buffer.from(baseCss.repeat(65)) : Buffer.alloc(52);
  await assert.rejects(() => captureFontJob([url], faces.value));
});
test("capture cancellation waits for its owned inspector to retire before returning", async () => {
  const p = ports();
  let entered = () => {},
    release = () => {};
  const started = new Promise<void>((resolve) => (entered = resolve));
  let settled = false;
  p.value.inspect = async () => {
    entered();
    await new Promise<void>((resolve) => (release = resolve));
    return { families: ["Example"], axes: [], weight: 400, style: "normal" };
  };
  const result = captureFontJob([url], p.value);
  result.then(
    () => (settled = true),
    () => (settled = true),
  );
  await started;
  p.clock.expire();
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await assert.rejects(() => result);
  assert.equal(settled, true);
});
