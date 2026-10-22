import test from "node:test";
import assert from "node:assert/strict";
import { createAttachmentHTTP } from "../src/browser/dataset-attachment-http.ts";
test("binary HTTP fixes its captured page path and sends raw body with credential headers only there", async () => {
  let body: unknown,
    url = "",
    init: RequestInit | undefined;
  const blob = new Blob(["abc"], { type: "image/png" }),
    ref = `dfile:${"a".repeat(32)}`;
  const port = createAttachmentHTTP({
    origin: "https://platform.invalid",
    pageId: () => "fixture",
    authority: () => "epoch",
    headers: () => ({ Authorization: "Bearer fixture" }),
    async fetch(u, i) {
      url = u;
      init = i;
      body = i.body;
      return Response.json({
        ref,
        url: `/api/files/fixture/dataset-attachments/data/images/${ref.slice(6)}`,
        name: "image.png",
        contentType: "image/png",
        size: 3,
      });
    },
  });
  const result = await port.upload({
    backendNamespace: "data",
    bindingName: "images",
    requestId: "request-0001",
    filename: "image.png",
    contentType: "image/png",
    blob,
  });
  assert.equal(body, blob);
  assert.equal(
    url,
    "https://platform.invalid/api/files/fixture/dataset-attachments/data/images",
  );
  assert.equal(init?.redirect, "error");
  assert.equal(init?.credentials, "omit");
  assert.equal(result.ref, ref);
});
test("binary HTTP rejects changed authority and oversized streamed reads", async () => {
  let context: string | null = "epoch";
  const port = createAttachmentHTTP({
    origin: "https://platform.invalid",
    pageId: () => "fixture",
    authority: () => context,
    headers: () => ({}),
    async fetch() {
      context = null;
      return Response.json({ canAttempt: true });
    },
  });
  await assert.rejects(
    port.availability({ backendNamespace: "data", bindingName: "images" }),
    /caller/i,
  );
  context = "epoch";
  const read = createAttachmentHTTP({
    origin: "https://platform.invalid",
    pageId: () => "fixture",
    authority: () => context,
    headers: () => ({}),
    async fetch() {
      return new Response(new Blob([new Uint8Array(50_000_001)]), {
        headers: { "Content-Type": "image/png" },
      });
    },
  });
  await assert.rejects(
    read.read({
      backendNamespace: "data",
      bindingName: "images",
      ref: `dfile:${"a".repeat(32)}`,
    }),
    /large/i,
  );
});

test("protected image reads retain validated UTF8 filename and actual byte size", async () => {
  const ref = `dfile:${"a".repeat(32)}`;
  const read = createAttachmentHTTP({
    origin: "https://platform.invalid",
    pageId: () => "fixture",
    authority: () => "epoch",
    headers: () => ({}),
    async fetch() {
      return new Response("abc", {
        headers: {
          "Content-Type": "image/webp",
          "Content-Disposition":
            "inline; filename=\"image\"; filename*=UTF-8''caf%C3%A9.webp",
        },
      });
    },
  });
  const blob = await read.read({
    backendNamespace: "data",
    bindingName: "images",
    ref,
  });
  assert.ok(blob instanceof File);
  assert.equal(blob.name, "café.webp");
  assert.equal(blob.size, 3);
  assert.equal(blob.type, "image/webp");
});
test("invalid or ambiguous filename headers do not become display metadata", async () => {
  for (const disposition of [
    "inline; filename*=UTF-8''..%2Fsecret.webp",
    "inline; filename*=UTF-8''bad%00.webp",
    "inline; filename*=UTF-8''%FF",
    "inline; filename*=UTF-8''one.webp; filename*=UTF-8''two.webp",
    "inline",
  ]) {
    const port = createAttachmentHTTP({
      origin: "https://platform.invalid",
      pageId: () => "fixture",
      authority: () => "epoch",
      headers: () => ({}),
      async fetch() {
        return new Response("abc", {
          headers: {
            "Content-Type": "image/webp",
            "Content-Disposition": disposition,
          },
        });
      },
    });
    const blob = await port.read({
      backendNamespace: "data",
      bindingName: "images",
      ref: `dfile:${"a".repeat(32)}`,
    });
    assert.equal(blob instanceof File, false);
    assert.equal(blob.size, 3);
  }
});
