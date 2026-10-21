import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, save } from "../source/codec.mjs";
import { createRepository } from "./workflow.ts";
const html =
  '<!doctype html><html><head><meta charset="utf-8"><script data-pagegi-runtime="2"></script><script id="pagegi-state" type="application/json">{"format":2,"app":{"count":9},"comments":[]}</script></head><body><h1 data-pagegi-id="title">Before café</h1><script type="application/pagegi">document.querySelector("h1").textContent="Rendered";</script></body></html>';
// Source API is authoring HTML, not an execution export: state comes from separate snapshots.
const codec = {
  async decode(html: string) {
    const d = await decode(html);
    return {
      source: save(d.source, { format: 2, app: null, comments: [] }),
      revision: d.revision,
      initialState: d.state.app,
    };
  },
};
test("real codec + disk agent roundtrip keeps source identity and historical snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "readable-workflow-"));
  try {
    const repo = createRepository(codec);
    const created = await repo.create("owner", "doc", html, "private");
    const state = (await decode(html)).state;
    repo.comment("owner", "doc", {
      id: "c1",
      sourceRevision: created.revision,
      targetId: "title",
      body: "Rename heading",
      snapshot: state.app,
    });
    const pulled = repo.pull("owner", "doc");
    const file = join(dir, "app.html");
    await writeFile(file, pulled.source);
    const readable = await readFile(file, "utf8");
    assert.match(readable, /Before café/);
    assert.match(readable, /application\/pagegi/);
    assert.doesNotMatch(readable, /base64/);
    await writeFile(file, readable.replace("Before café", "After café"));
    const pushed = await repo.push(
      "owner",
      "doc",
      pulled.revision,
      await readFile(file, "utf8"),
    );
    assert.notEqual(pushed.revision, pulled.revision);
    assert.deepEqual(pushed.initialState, { count: 9 });
    await assert.rejects(repo.push("owner", "doc", pulled.revision, readable), {
      code: "CONFLICT",
    });
    const historical = repo.context("owner", "doc", "c1");
    assert.match(historical.source.source, /Before café/);
    assert.deepEqual(historical.comment.snapshot, { count: 9 });
    const exported = save((await decode(historical.source.source)).source, {
      format: 2,
      app: historical.comment.snapshot,
      comments: [],
    });
    const reopened = await decode(exported);
    assert.equal(reopened.revision, pulled.revision);
    assert.deepEqual(reopened.state.app, { count: 9 });
    assert.match(repo.pull("owner", "doc").source, /After café/);
    assert.match(repo.pull("owner", "doc").source, /data-pagegi-id="title"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
