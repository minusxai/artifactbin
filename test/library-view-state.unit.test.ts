import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryViewState } from "../src/library-client/view-state.ts";

test("view failures retry independently and invalidated completions cannot commit", async () => {
  const view = createLibraryViewState({ changed: () => {} });
  assert.equal(
    await view.render(async () => {
      throw Error("sharing unavailable");
    }),
    false,
  );
  assert.equal(view.getSnapshot().error, "sharing unavailable");
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let committed = false;
  const old = view.render(async (current) => {
    await gate;
    if (current()) committed = true;
  });
  view.invalidate();
  finish();
  assert.equal(await old, false);
  assert.equal(committed, false);
  assert.deepEqual(view.getSnapshot(), { pending: false, error: null });
  assert.equal(await view.render(async () => {}), true);
});

test("a stale rendering failure cannot replace a newer successful view", async () => {
  const view = createLibraryViewState({ changed: () => {} });
  let reject!: (error: Error) => void;
  const old = view.render(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  assert.equal(await view.render(async () => {}), true);
  reject(Error("old account sharing failed"));
  assert.equal(await old, false);
  assert.deepEqual(view.getSnapshot(), { pending: false, error: null });
});
