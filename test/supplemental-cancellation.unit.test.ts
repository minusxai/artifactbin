import test from "node:test";
import assert from "node:assert/strict";
import { supplementalRepository } from "../src/persistence/supplemental-media.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { abortableMediaStore } from "../src/media/abortable-store.ts";
const comment = {
  kind: "comment" as const,
  pageId: "ABC123",
  commentId: "comment",
  attachmentId: "attachment",
  variant: "original" as const,
};
const person = {
  kind: "person" as const,
  pageId: "ABC123",
  valueName: "assignee",
  assetId: "a".repeat(64),
};
test("both supplemental read kinds abort queued SQL acquisition and discard a late connection", async () => {
  for (const address of [comment, person]) {
    let acquire: any,
      started: any,
      released = 0;
    const connected = new Promise<void>((r) => {
      started = r;
    });
    const database = createSqlDatabase({
      initialize: async () => {},
      statementTimeoutMs: 15000,
      pool: {
        connect() {
          started();
          return new Promise((r) => {
            acquire = r;
          });
        },
      },
    });
    const repository = supplementalRepository(database, Date.now, {
      async person() {
        throw Error("must not query person");
      },
    });
    const controller = new AbortController();
    const pending = repository.read(address, "synthetic", controller.signal);
    await connected;
    controller.abort();
    await assert.rejects(pending);
    acquire({
      async query() {
        throw Error("must not query cancelled SQL");
      },
      release(discard: any) {
        assert.equal(discard, true);
        released++;
      },
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(released, 1);
  }
});
test("cancelled object open disposes a late descriptor and a stalled object read settles on abort", async () => {
  let release: any,
    closes = 0;
  const descriptor: any = {};
  let controller = new AbortController();
  let store = abortableMediaStore(
    {
      open: () =>
        new Promise((r) => {
          release = r;
        }),
    },
    controller.signal,
  );
  const opening = store.open(descriptor);
  controller.abort();
  await assert.rejects(opening);
  release({
    close: async () => {
      closes++;
    },
    stream: async function* () {},
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closes, 1);
  controller = new AbortController();
  store = abortableMediaStore(
    {
      async open() {
        return {
          close: async () => {
            closes++;
          },
          stream() {
            return {
              [Symbol.asyncIterator]() {
                return { next: () => new Promise(() => {}) };
              },
            };
          },
        };
      },
    },
    controller.signal,
  );
  const object = await store.open(descriptor);
  const reading = object.stream()[Symbol.asyncIterator]().next();
  controller.abort();
  await assert.rejects(reading);
  assert.equal(closes, 2);
  await object.close();
  assert.equal(closes, 2);
});
