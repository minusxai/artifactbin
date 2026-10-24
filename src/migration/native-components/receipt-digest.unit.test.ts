import test from "node:test";
import assert from "node:assert/strict";
import { nativeDigest } from "./selection.ts";
import { nativeReceiptDigest } from "./receipt-digest.ts";

test("receipt digests treat Buffer and Uint8Array as the same exact bytes", () => {
  const bytes = Buffer.from([0, 1, 127, 128, 255]);
  assert.equal(
    nativeReceiptDigest({ file: bytes }),
    nativeReceiptDigest({ file: new Uint8Array(bytes) }),
  );
  assert.notEqual(
    nativeReceiptDigest({ file: bytes }),
    nativeReceiptDigest({ file: Buffer.from([0, 1, 127, 128, 254]) }),
  );
  assert.equal(
    nativeReceiptDigest({ file: bytes.subarray(1, 4) }),
    nativeReceiptDigest({ file: new Uint8Array([1, 127, 128]) }),
  );
});

test("binary receipt tokens cannot collide with ordinary tagged JSON objects", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const taggedObject = {
    file: { type: "Uint8Array", byteLength: 3, data: [1, 2, 3] },
  };
  assert.notEqual(
    nativeReceiptDigest({ file: bytes }),
    nativeReceiptDigest(taggedObject),
  );
  assert.notEqual(
    nativeReceiptDigest({ file: bytes }),
    nativeReceiptDigest({ file: "\0native-receipt:uint8:3:\u0001\u0002\u0003\0" }),
  );
  assert.notEqual(
    nativeReceiptDigest({ file: new Uint8Array() }),
    nativeReceiptDigest({ file: "" }),
  );
});

test("binary-free receipt values retain the frozen native JSON digest", () => {
  const value = {
    z: [1, null, { y: "text", x: true }],
    a: { b: 2, a: 1 },
  };
  assert.equal(nativeReceiptDigest(value), nativeDigest(value));
  assert.equal(
    nativeReceiptDigest({ keep: 1, omit: undefined }),
    nativeReceiptDigest({ keep: 1 }),
  );
  assert.equal(nativeReceiptDigest([undefined]), nativeReceiptDigest([null]));
  assert.equal(
    nativeReceiptDigest({
      nested: {
        "2": "two",
        "10": "ten",
        "1": "one",
        "01": "leading zero",
        b: "bee",
        a: "aye",
        "4294967295": "not an array index",
      },
      values: [Number.NaN, -0, Infinity],
    }),
    nativeDigest({
      nested: {
        "2": "two",
        "10": "ten",
        "1": "one",
        "01": "leading zero",
        b: "bee",
        a: "aye",
        "4294967295": "not an array index",
      },
      values: [Number.NaN, -0, Infinity],
    }),
  );
});
