import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetAttachmentService } from "../src/datasets/attachments/service.ts";
import type {
  DatasetAttachmentRepository,
  DatasetAttachmentStorage,
  DatasetAttachmentContext,
  DatasetAttachmentUpload,
} from "../src/datasets/attachments/contracts.ts";
import { attachmentSnapshot } from "./fixtures/dataset-attachment.ts";
const context: DatasetAttachmentContext = {
  backendId: "Back12",
  backendVersion: "a".repeat(64),
  pageId: "Page12",
  subject: "actor",
  credentialHash: "session",
  backendNamespace: "legacyData",
  bindingName: "images",
};
function fixture() {
  let discarded = 0,
    committed = 0,
    closed = 0;
  const record = {
    id: "a".repeat(32),
    sourceNamespace: "original",
    datasetId: "data",
    pageId: "Page12",
    object: {
      sha256: "b".repeat(64),
      storageKey: "b".repeat(64),
      byteLength: 8,
      contentType: "image/png" as const,
      filename: "photo.png",
    },
  };
  const repository: DatasetAttachmentRepository = {
    authority: async () => attachmentSnapshot(),
    commit: async () => {
      committed++;
      return { record, replayed: false };
    },
    read: async () => ({ record, generation: "1" }),
  };
  const storage: DatasetAttachmentStorage = {
    stage: async () => ({
      inputSha256: "c".repeat(64),
      object: record.object,
      publish: async () => {},
      discard: async () => {
        discarded++;
      },
    }),
    open: async () => ({
      body: (async function* () {
        yield new Uint8Array(8);
      })(),
      close: async () => {
        closed++;
      },
    }),
  };
  const upload = (): DatasetAttachmentUpload => ({
    requestId: "request_123",
    filename: "photo.png",
    contentType: "image/png",
    body: (async function* () {
      yield new Uint8Array(8);
    })(),
  });
  return {
    repository,
    storage,
    upload,
    service: createDatasetAttachmentService({ repository, storage }),
    counts: () => ({ discarded, committed, closed }),
  };
}
test("upload returns fixed local ref URL and always discards staging after committed receipt", async () => {
  const f = fixture();
  const r = await f.service.upload(context, f.upload());
  assert.equal(r.ref, "dfile:" + "a".repeat(32));
  assert.equal(
    r.url,
    "/api/files/Page12/dataset-attachments/legacyData/images/" + "a".repeat(32),
  );
  assert.deepEqual(f.counts(), { discarded: 1, committed: 1, closed: 0 });
});
test("known final refusal discards staging; no forged or malformed initial upload reaches storage", async () => {
  const f = fixture();
  f.repository.commit = async () => {
    throw new Error("revoked");
  };
  await assert.rejects(f.service.upload(context, f.upload()));
  assert.equal(f.counts().discarded, 1);
  for (const filename of ["../photo.png", "x\\y", "bad\nname"])
    await assert.rejects(
      f.service.upload(context, { ...f.upload(), filename }),
    );
  assert.equal(f.counts().discarded, 1);
});
test("admission stays bounded through cleanup and rejects extra work synchronously", async () => {
  const f = fixture();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  f.storage.stage = async () => {
    await held;
    throw new Error("stopped");
  };
  const first = f.service.upload(context, f.upload());
  const second = f.service.upload(context, f.upload());
  await assert.rejects(f.service.upload(context, f.upload()), { code: "busy" });
  release();
  await Promise.allSettled([first, second]);
});
test("revocation after open closes body and denies delivery", async () => {
  const f = fixture();
  let calls = 0;
  const initial = f.repository.read;
  f.repository.read = async (...args) =>
    ++calls === 1 ? initial(...args) : null;
  assert.equal(await f.service.read(context, "a".repeat(32)), null);
  assert.equal(f.counts().closed, 1);
});
test("changed attachment generation after object open cannot deliver stale body", async () => {
  const f = fixture();
  let calls = 0;
  const original = f.repository.read;
  f.repository.read = async (...args) => {
    const r = await original(...args);
    return r && { ...r, generation: String(++calls) };
  };
  assert.equal(await f.service.read(context, "a".repeat(32)), null);
  assert.equal(f.counts().closed, 1);
});

test("availability is fresh attachment insert-only authority with no staging or commit", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.availability(context), { canAttempt: true });
  f.repository.authority = async () => null;
  assert.deepEqual(await f.service.availability(context), {
    canAttempt: false,
  });
  assert.deepEqual(f.counts(), { discarded: 0, committed: 0, closed: 0 });
});
