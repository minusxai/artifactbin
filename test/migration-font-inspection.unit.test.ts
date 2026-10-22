import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectSfnt } from "../src/migration/conversion/compiled/fonts/inspect.ts";
function fixture() {
  const name = Buffer.from("Example", "utf16le").swap16(),
    bytes = Buffer.alloc(44 + 64 + 18 + name.length);
  bytes.writeUInt32BE(0x10000);
  bytes.writeUInt16BE(2, 4);
  for (const [i, tag, offset, length] of [
    [0, "OS/2", 44, 64],
    [1, "name", 108, 18 + name.length],
  ] as const) {
    const p = 12 + i * 16;
    bytes.write(tag, p);
    bytes.writeUInt32BE(offset, p + 8);
    bytes.writeUInt32BE(length, p + 12);
  }
  bytes.writeUInt16BE(400, 48);
  bytes.writeUInt16BE(1, 110);
  bytes.writeUInt16BE(18, 112);
  bytes.writeUInt16BE(3, 114);
  bytes.writeUInt16BE(1, 116);
  bytes.writeUInt16BE(1, 120);
  bytes.writeUInt16BE(name.length, 122);
  name.copy(bytes, 126);
  return bytes;
}
test("font inspection reads bounded family/style/weight metadata and refuses escaped table spans", () => {
  const bytes = fixture(),
    result = inspectSfnt(bytes);
  assert.equal(result.weight, 400);
  assert.equal(result.style, "normal");
  assert.deepEqual(result.families, ["Example"]);
  const bad = Buffer.from(bytes);
  bad.writeUInt32BE(99999, 20);
  assert.throws(() => inspectSfnt(bad));
  assert.throws(() => inspectSfnt(Buffer.alloc(8)));
});
test("font variation inspection retains exact defaults and rejects malformed axis or family metadata", () => {
  const original = fixture(),
    bytes = Buffer.alloc(original.length + 16 + 36);
  original.copy(bytes, 0, 0, 44);
  bytes.writeUInt16BE(3, 4);
  for (let i = 0; i < 2; i++)
    bytes.writeUInt32BE(original.readUInt32BE(20 + i * 16) + 16, 20 + i * 16);
  original.copy(bytes, 60, 44);
  const offset = original.length + 16;
  bytes.write("fvar", 44);
  bytes.writeUInt32BE(offset, 52);
  bytes.writeUInt32BE(36, 56);
  bytes.writeUInt32BE(0x10000, offset);
  bytes.writeUInt16BE(16, offset + 4);
  bytes.writeUInt16BE(1, offset + 8);
  bytes.writeUInt16BE(20, offset + 10);
  bytes.write("wght", offset + 16);
  bytes.writeInt32BE(200 * 65536, offset + 20);
  bytes.writeInt32BE(400 * 65536, offset + 24);
  bytes.writeInt32BE(800 * 65536, offset + 28);
  assert.deepEqual(inspectSfnt(bytes).axes, [
    { tag: "wght", min: 200, default: 400, max: 800 },
  ]);
  const bad = Buffer.from(bytes);
  bad.writeInt32BE(900 * 65536, offset + 24);
  assert.throws(() => inspectSfnt(bad));
  const name = Buffer.from(original);
  name.writeUInt16BE(1, 122);
  assert.throws(() => inspectSfnt(name));
});
