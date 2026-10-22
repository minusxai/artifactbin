import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
  socialPreview,
  socialPreviewHead,
} from "../src/server/social-preview.ts";
import { hostedShell } from "../src/hosted.js";

test("social metadata uses bounded page text and only trusted addresses", () => {
  const preview = socialPreview(
    '<title>A &amp; B</title><meta name="description" content="A &quot;quoted&quot; summary"><meta property="og:image" content="https://untrusted.invalid/private">',
    {
      url: "https://example.test/a/page?version=1",
      imageUrl: "https://example.test/a/page/export?version=1",
    },
  );
  assert.deepEqual(preview, {
    title: "A & B",
    description: 'A "quoted" summary',
    url: "https://example.test/a/page?version=1",
    imageUrl: "https://example.test/a/page/export?version=1",
  });
  assert.equal(
    socialPreview(
      "<title>" +
        "x".repeat(1000) +
        '</title><meta name="description" content="' +
        "y".repeat(2000) +
        '">',
      { url: "https://example.test/a/page" },
    ).description.length,
    300,
  );
  assert.equal(
    socialPreview("<h1>Heading</h1><script>secret()</script>", {
      url: "https://example.test/a/page",
    }).description,
    "",
  );
});

test("metadata escapes title, description and trusted address attributes", () => {
  const preview = {
    title: '</title><script>alert("x")</script>',
    description: '" onload="bad & <unsafe>',
    url: 'https://example.test/a/page?x="&y=1',
    imageUrl: 'https://example.test/card?x="',
  };
  const markup = socialPreviewHead(preview);
  assert.doesNotMatch(markup, /<script|<unsafe|content="" onload=/);
  assert.match(markup, /property="og:title"/);
  assert.match(markup, /name="twitter:card" content="summary_large_image"/);
  assert.match(markup, /&quot;/);
  assert.match(markup, /&amp;/);
  const shell = hostedShell({
    title: "Document",
    boot: { sourceUrl: "/source" },
    preview,
  });
  assert.ok(shell.includes(markup));
});

test("a shell without page metadata never invents a card endpoint", () => {
  const markup = socialPreviewHead({
    title: "Untitled document",
    description: "",
    url: "https://example.test/a/page",
  });
  assert.match(markup, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(markup, /og:image|twitter:image/);
});

test("static PNG card requires current authorization and returns isolated bounded bytes", async () => {
  const { socialPreviewCard } = await import("../src/server/social-preview.ts");
  for (const status of [401, 403, 404]) {
    const denied = Object.assign(new Error("Not found"), { status });
    await assert.rejects(
      socialPreviewCard({
        authorize: async () => {
          throw denied;
        },
      }),
      (error) => error === denied,
    );
  }
  let checked = false;
  const card = await socialPreviewCard({
    authorize: async () => {
      checked = true;
    },
  });
  assert.equal(checked, true);
  assert.equal(card.contentType, "image/png");
  assert.equal(card.cacheControl, "private, no-store");
  assert.deepEqual(
    [...card.bytes.slice(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  assert.ok(card.bytes.length < 100_000);
  const png = Buffer.from(card.bytes);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(inflateSync(Buffer.concat(chunks)).length, 630 * (1 + 1200 * 3));
  const original = card.bytes[0];
  card.bytes[0] = 0;
  assert.equal(
    (await socialPreviewCard({ authorize: async () => {} })).bytes[0],
    original,
  );
});
