import test from "node:test";
import assert from "node:assert/strict";
import { CommentComposer } from "../src/browser/comment-composer.ts";
import type { CommentSelection } from "../src/browser/comment-panel-contracts.ts";
const pick = (): CommentSelection => ({
  nodeId: "a",
  quote: "Selected",
  snapshot: {
    schema: 1,
    sourceRevision: "r1",
    state: { count: 1 },
    view: { x: 0, y: 0 },
  },
});
test("composer captures context without retaining caller mutations and closes an old thread", () => {
  const model = new CommentComposer(),
    selection = pick();
  model.interaction.active = "old";
  model.open(selection);
  selection.snapshot!.state.count = 9;
  assert.equal(model.selection!.snapshot!.state.count, 1);
  assert.equal(model.interaction.active, null);
});
test("composer draft identity includes source revision, with fallback for static captures", () => {
  const model = new CommentComposer();
  assert.equal(model.key(pick(), "other"), "new:a:r1");
  assert.equal(
    model.key({ nodeId: null, quote: "", snapshot: null }, "r2"),
    "new:null:r2",
  );
});
test("closing preserves all drafts; sending removes only its draft and opens its thread", () => {
  const model = new CommentComposer(),
    selection = pick();
  model.interaction.drafts = {
    "new:a:r1": "new",
    thread: "reply",
    other: "keep",
  };
  model.open(selection);
  model.close();
  assert.equal(model.interaction.drafts["new:a:r1"], "new");
  assert.equal(model.selection, null);
  model.sent("created", selection, "r1", null);
  assert.deepEqual(model.interaction.drafts, {
    thread: "reply",
    other: "keep",
  });
  assert.equal(model.interaction.active, "created");
  assert.equal(model.interaction.pinned, true);
  model.sent("reply-id", selection, "r1", "thread");
  assert.deepEqual(model.interaction.drafts, { other: "keep" });
  assert.equal(model.interaction.active, "thread");
});
test("an open thread and its draft follow a comment to the server's ID", () => {
  const model = new CommentComposer();
  model.interaction = {
    active: "local",
    pinned: true,
    expanded: true,
    drafts: { local: "half a reply", other: "keep" },
  };
  model.rename("local", "server");
  assert.equal(model.interaction.active, "server");
  assert.deepEqual(model.interaction.drafts, { other: "keep", server: "half a reply" });
  model.rename("missing", "x");
  assert.equal(model.interaction.active, "server");
});
