import test from "node:test";
import assert from "node:assert/strict";
import { createCompiledFileUploads } from "../src/migration/conversion/compiled/file-upload-runtime.ts";
import type {
  AttachmentUpload,
  AttachmentReceipt,
} from "../src/browser/dataset-attachment-bridge-contracts.ts";
const ref = `dfile:${"a".repeat(32)}`,
  receipt: AttachmentReceipt = {
    ref,
    url: `/api/files/fixture/dataset-attachments/data/images/${ref.slice(6)}`,
    name: "image.png",
    contentType: "image/png",
    size: 3,
  };
const tick = () => new Promise<void>((r) => setImmediate(r));
function fixture() {
  let authority: { generation: string; allowed: boolean } | null = {
      generation: "caller-one",
      allowed: true,
    },
    listener = () => {},
    attempts: AttachmentUpload[] = [],
    revoked: string[] = [];
  let read: () => Promise<Blob> = async () =>
    new Blob(["abc"], { type: "image/png" });
  let upload: (
    request: AttachmentUpload,
    signal?: AbortSignal,
  ) => Promise<AttachmentReceipt> = async () => receipt;
  const model = createCompiledFileUploads({
    sites: [
      {
        backendNamespace: "data",
        bindingName: "images",
        valueName: "files",
        busyName: "busy",
        multiple: true,
        maxFiles: 5,
        acceptedTypes: ["image/png"],
      },
    ],
    authority: () => authority,
    subscribe: (f) => {
      listener = f;
      return () => {
        listener = () => {};
      };
    },
    transport: () => ({
      async availability() {
        return { canAttempt: true };
      },
      upload: (r, s) => {
        attempts.push(r);
        return upload(r, s);
      },
      read: () => read(),
    }),
    id: () => "request-0001",
    createURL: () => "blob:fixture",
    revokeURL: (u) => revoked.push(u),
    changed() {},
  });
  return {
    model,
    attempts,
    revoked,
    setRead: (f: typeof read) => {
      read = f;
    },
    setUpload: (f: typeof upload) => {
      upload = f;
    },
    setAuthority: (a: typeof authority) => {
      authority = a;
      listener();
    },
  };
}
test("native upload waits for its exact insert advisory and snapshots one retry intent", async () => {
  const f = fixture(),
    file = new File(["abc"], "image.png", { type: "image/png" });
  assert.ok(f.model.unavailable("files"));
  await tick();
  assert.equal(f.model.unavailable("files"), null);
  f.setUpload(async () => {
    throw Error("lost response");
  });
  await assert.rejects(f.model.upload("files", "images", file));
  f.setUpload(async () => receipt);
  assert.equal((await f.model.upload("files", "images", file)).ref, ref);
  assert.equal(f.attempts.length, 2);
  assert.equal(f.attempts[0]?.requestId, f.attempts[1]?.requestId);
  assert.equal(f.attempts[0]?.blob, f.attempts[1]?.blob);
  await assert.rejects(f.model.upload("files", "other", file));
  f.model.dispose();
});
test("selection release and caller changes cannot apply delayed uploads or keep object URLs", async () => {
  const f = fixture();
  await tick();
  assert.equal(f.model.fileUrl("files", "images", ref), undefined);
  await tick();
  assert.equal(f.model.fileUrl("files", "images", ref), "blob:fixture");
  let finish!: (r: AttachmentReceipt) => void;
  f.setUpload(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = f.model.upload(
      "files",
      "images",
      new File(["abc"], "image.png", { type: "image/png" }),
    ),
    rejected = assert.rejects(pending);
  await tick();
  f.model.release("files");
  finish(receipt);
  await rejected;
  assert.deepEqual(f.revoked, ["blob:fixture"]);
  f.setAuthority(null);
  assert.ok(f.model.unavailable("files"));
  f.model.dispose();
});

test("reloaded refs hydrate display metadata only from current protected bytes", async () => {
  const f = fixture();
  f.setRead(
    async () => new File(["abc"], "saved image.webp", { type: "image/webp" }),
  );
  await tick();
  assert.equal(f.model.fileMetadata("files", "images", ref), undefined);
  await tick();
  assert.deepEqual(f.model.fileMetadata("files", "images", ref), {
    name: "saved image.webp",
    size: 3,
    contentType: "image/webp",
  });
  f.setAuthority(null);
  assert.equal(f.model.fileMetadata("files", "images", ref), undefined);
  f.model.dispose();
});
test("metadata without a valid protected filename retains size without exposing refs as names", async () => {
  const f = fixture();
  f.setRead(async () => new Blob(["abc"], { type: "image/png" }));
  await tick();
  f.model.fileMetadata("files", "images", ref);
  await tick();
  assert.deepEqual(f.model.fileMetadata("files", "images", ref), {
    size: 3,
    contentType: "image/png",
  });
  f.model.dispose();
});
