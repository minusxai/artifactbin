import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommentAttachmentResources } from "../src/browser/comment-attachment-resources.ts";
import type { CommentAttachment } from "../src/comment-attachment-contracts.ts";
const image = new Blob(["image"], { type: "image/webp" });
const attachment: CommentAttachment = {
  id: "image-1",
  name: "Screenshot",
  variants: [
    {
      variant: "thumbnail",
      mimeType: "image/webp",
      bytes: 5,
      width: 20,
      height: 10,
      sha256: "a".repeat(64),
    },
  ],
};
const variant = attachment.variants[0]!;
function fixture(load: (...args: any[]) => Promise<Blob>) {
  const created: Blob[] = [],
    revoked: string[] = [];
  const resources = createCommentAttachmentResources({
    load,
    createURL(blob) {
      created.push(blob);
      return "blob:owned-" + created.length;
    },
    revokeURL(url) {
      revoked.push(url);
    },
  });
  return { resources, created, revoked };
}
test("attachment reads require current authority; authority loss revokes loaded images exactly once", async () => {
  let loads = 0,
    invalidations = 0;
  const f = fixture(async () => {
    loads++;
    return image;
  });
  await assert.rejects(
    f.resources.acquire("comment", attachment, variant),
    /access/i,
  );
  assert.equal(loads, 0);
  f.resources.setAuthority("caller-a");
  f.resources.subscribeInvalidation(() => invalidations++);
  const lease = await f.resources.acquire("comment", attachment, variant);
  assert.equal(lease.url, "blob:owned-1");
  f.resources.setAuthority("caller-a");
  assert.equal(invalidations, 0);
  f.resources.setAuthority(null);
  assert.deepEqual(f.revoked, [lease.url]);
  assert.equal(invalidations, 1);
  lease.release();
  f.resources.dispose();
  f.resources.dispose();
  assert.deepEqual(f.revoked, [lease.url]);
});
test("held reads cannot publish after caller switch, disposal or individual cancellation even if transport ignores abort", async () => {
  for (const end of ["switch", "dispose", "cancel"] as const) {
    let resolve!: (value: Blob) => void, signal!: AbortSignal;
    const f = fixture(async (_c, _a, _v, s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    });
    f.resources.setAuthority("a");
    const controller = new AbortController();
    const pending = f.resources.acquire(
      "comment",
      attachment,
      variant,
      controller.signal,
    );
    if (end === "switch") f.resources.setAuthority("b");
    else if (end === "dispose") f.resources.dispose();
    else controller.abort();
    assert.equal(signal.aborted, true);
    resolve(image);
    await assert.rejects(pending, /cancel|access|disposed/i);
    assert.equal(f.created.length, 0);
  }
});
test("access denial retires all displayed images and pending sibling reads", async () => {
  let deny = false;
  const f = fixture(async () => {
    if (deny) throw Object.assign(Error("Denied"), { status: 403 });
    return image;
  });
  f.resources.setAuthority("a");
  const shown = await f.resources.acquire("comment", attachment, variant);
  deny = true;
  await assert.rejects(
    f.resources.acquire("comment", attachment, variant),
    /Denied/,
  );
  assert.deepEqual(f.revoked, [shown.url]);
  await assert.rejects(
    f.resources.acquire("comment", attachment, variant),
    /access/i,
  );
});
test("malformed metadata, unexpected image bytes and executable MIME never create a display URL", async () => {
  const f = fixture(async () => new Blob(["image"], { type: "text/html" }));
  f.resources.setAuthority("a");
  await assert.rejects(
    f.resources.acquire("comment", attachment, variant),
    /image/i,
  );
  await assert.rejects(
    f.resources.acquire("comment", attachment, { ...variant, bytes: 0 }),
    /metadata/i,
  );
  await assert.rejects(
    f.resources.acquire("comment", attachment, {
      ...variant,
      sha256: "not-a-digest",
    }),
    /metadata/i,
  );
  await assert.rejects(
    f.resources.acquire("comment", attachment, {
      ...variant,
      variant: "original",
    }),
    /metadata/i,
  );
  assert.equal(f.created.length, 0);
});

test("pending image reads are bounded and a denied sibling aborts the held read", async () => {
  const signals: AbortSignal[] = [];
  let resolve!: (value: Blob) => void;
  let denied = false;
  const f = fixture(async (_c, _a, _v, signal) => {
    signals.push(signal);
    if (denied) throw Object.assign(Error("Denied"), { status: 403 });
    return new Promise((r) => {
      resolve = r;
    });
  });
  f.resources.setAuthority("a");
  const first = f.resources.acquire("comment", attachment, variant);
  denied = true;
  await assert.rejects(
    f.resources.acquire("comment", attachment, variant),
    /Denied/,
  );
  assert.equal(signals[0]!.aborted, true);
  resolve(image);
  await assert.rejects(first, /cancel/i);
  assert.equal(f.created.length, 0);

  const g = fixture(async () => new Promise(() => {}));
  g.resources.setAuthority("b");
  for (let i = 0; i < 32; i++)
    void g.resources.acquire("comment", attachment, variant);
  await assert.rejects(
    g.resources.acquire("comment", attachment, variant),
    /Too many/,
  );
  g.resources.dispose();
});
