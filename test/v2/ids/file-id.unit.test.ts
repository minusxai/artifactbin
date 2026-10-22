import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AF_ORIGIN, FILE_ID_ALPHABET, FILE_ID_PATTERN } from "../../../src/af-contracts.ts";
import type { FileIdModule } from "../../../src/ids/file-id-contracts.ts";
import { load } from "../support/load.ts";
import { skillFile } from "../support/skill.ts";

const ids = () => load<FileIdModule>("src/ids/file-id.ts");

/** Hands out the given bytes in order, however many are asked for at a time. */
function bytes(...values: number[]) {
  let index = 0;
  return (count: number) => {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (index >= values.length) throw Error("ran out of bytes");
      out[i] = values[index++]!;
    }
    return out;
  };
}

test("a file ID is six letters and digits drawn with rejection sampling", async () => {
  const { generateFileId } = await ids();
  // b < 248 maps to FILE_ID_ALPHABET[b % 62]; 247 is the largest accepted byte.
  assert.equal(generateFileId(bytes(0, 1, 2, 61, 62, 247)), "ABC9A9");
  assert.equal(generateFileId(bytes(26, 36, 51, 52, 98, 186)), "akz0kA");
  // 248..255 would bias the alphabet; they are discarded.
  assert.equal(generateFileId(bytes(248, 255, 0, 250, 1, 2, 3, 4, 5)), "ABCDEF");
  for (let i = 0; i < 200; i++) {
    const id = generateFileId((n) => crypto.getRandomValues(new Uint8Array(n)));
    assert.match(id, FILE_ID_PATTERN);
  }
  assert.equal(FILE_ID_ALPHABET.length, 62);
});

test("the skill's example IDs are valid, and nothing else is", async () => {
  const { isFileId } = await ids();
  for (const id of ["Bk7Qa2", "Cr4mZ9", "Pg4mQ2"]) assert.equal(isFileId(id), true, id);
  for (const id of ["Bk7Qa", "Bk7Qa2x", "Bk7Q-2", "Bk7Q_2", "", 123456, null, "abcdefghijkl"])
    assert.equal(isFileId(id), false, String(id));
  assert.match(skillFile("SKILL.md"), /six letters and digits/);
});

test("a page's address is /a/<id> on any host; a backend link address is /af/v1/ids/<id>", async () => {
  const { fileAddress, parseFileAddress } = await ids();
  assert.equal(fileAddress("https://artifactbin.dev", "Bk7Qa2"), "https://artifactbin.dev/a/Bk7Qa2");
  assert.equal(fileAddress("http://127.0.0.1:8787", "Bk7Qa2"), "http://127.0.0.1:8787/a/Bk7Qa2");
  assert.match(skillFile("SKILL.md"), new RegExp(`${DEFAULT_AF_ORIGIN.replace(/[.]/g, "\\.")}/a/<id>`));
  assert.throws(() => fileAddress("https://artifactbin.dev/base", "Bk7Qa2"));
  assert.throws(() => fileAddress("https://artifactbin.dev", "bad"));
  assert.equal(parseFileAddress("https://artifactbin.dev/af/v1/ids/Bk7Qa2"), "Bk7Qa2");
  assert.equal(parseFileAddress("http://localhost:9/af/v1/ids/Cr4mZ9"), "Cr4mZ9");
  for (const href of [
    "https://artifactbin.dev/af/v1/ids/Bk7Qa2/extra",
    "https://artifactbin.dev/af/v1/ids/Bk7Qa2?x=1",
    "https://artifactbin.dev/af/v2/ids/Bk7Qa2",
    "/af/v1/ids/Bk7Qa2",
    "https://artifactbin.dev/af/v1/ids/Bk7Q",
    "backends/billing.ts",
  ])
    assert.equal(parseFileAddress(href), null, href);
});

test("a request path names a page by ID (with any title slug) or by its owner's library path", async () => {
  const { parseAddressPath } = await ids();
  for (const path of ["/a/Bk7Qa2", "/a/Bk7Qa2-", "/a/Bk7Qa2-quarterly-report", "/a/Bk7Qa2-with.dots_and%20escapes"])
    assert.deepEqual(parseAddressPath(path), { kind: "id", id: "Bk7Qa2" }, path);
  assert.deepEqual(parseAddressPath("/@alice/notes.html"), { kind: "path", handle: "alice", path: "/notes.html" });
  assert.deepEqual(parseAddressPath("/@alice%40example.test/research/my%20notes.html"), {
    kind: "path",
    handle: "alice@example.test",
    path: "/research/my notes.html",
  });
  for (const path of [
    "/af/v1/ids/Bk7Qa2",
    "/a/Bk7Qa",
    "/a/Bk7Qa2x",
    "/a/Bk7Qa2/extra",
    "/a/Bk7Qa2-slug/extra",
    "/a/",
    "/a",
    "/@alice",
    "/@alice/",
    "/@/notes.html",
    "/@alice//notes.html",
    "/@alice/../secret.html",
    "/@alice/%2e%2e/secret.html",
    "/@alice/%2fnotes.html",
    "/@alice/%ZZ",
    "/",
    "/account",
  ])
    assert.equal(parseAddressPath(path), null, path);
});

test("legacyHandleAddressId: one segment that is an ID, or an ID and a hyphenated slug", async () => {
  const { legacyHandleAddressId } = await ids();
  assert.equal(legacyHandleAddressId("/Ab12Cd"), "Ab12Cd");
  assert.equal(legacyHandleAddressId("/Ab12Cd-"), "Ab12Cd");
  assert.equal(legacyHandleAddressId("/Ab12Cd-quarterly report.html"), "Ab12Cd");
  for (const path of ["/Ab12C", "/Ab12Cd7", "/Ab12Cd.html", "/Ab12Cd/extra", "/Ab12Cd-slug/extra", "/x/Ab12Cd", "Ab12Cd", "/", "", "/Ab12C-d", "/notes.html"])
    assert.equal(legacyHandleAddressId(path), null, path);
});
