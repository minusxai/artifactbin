import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWoff2Bounds } from "../src/migration/conversion/compiled/fonts/woff2.ts";
function fixture() {
  const b = Buffer.alloc(52);
  b.write("wOF2");
  b.writeUInt32BE(0x10000, 4);
  b.writeUInt32BE(52, 8);
  b.writeUInt16BE(1, 12);
  b.writeUInt32BE(128, 16);
  b.writeUInt32BE(2, 20);
  b[48] = 0;
  b[49] = 100;
  return b;
}
test("WOFF2 original and transformed table budgets are checked before decoder allocation", () => {
  const b = fixture();
  validateWoff2Bounds(b);
  for (const change of [
    (v: Buffer) => v.writeUInt32BE(4_000_001, 16),
    (v: Buffer) => v.writeUInt32BE(3, 20),
    (v: Buffer) => v.writeUInt16BE(0, 12),
    (v: Buffer) => (v[49] = 0x80),
    (v: Buffer) => (v[48] = 0xc0),
    (v: Buffer) => v.writeUInt32BE(0x74746366, 4),
    (v: Buffer) => (v[49] = 101),
  ]) {
    const bad = Buffer.from(b);
    change(bad);
    assert.throws(() => validateWoff2Bounds(bad));
  }
});
