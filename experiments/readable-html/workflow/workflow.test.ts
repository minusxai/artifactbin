import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRepository, createBridge } from "./workflow.ts";
const codec = {
  async decode(source: string) {
    if (!source.startsWith("<!doctype html>")) throw Error("bad source");
    return {
      source,
      revision: createHash("sha256").update(source).digest("hex"),
    };
  },
};
const old = '<!doctype html><h1 data-pagegi-id="title">Before</h1>';
const next = '<!doctype html><h1 data-pagegi-id="title">After</h1>';
const third = '<!doctype html><h1 data-pagegi-id="title">Third</h1>';
const input = (rev: string) => ({
  id: "c1",
  sourceRevision: rev,
  snapshot: { count: 2 },
  targetId: "title",
  body: "Please edit heading",
});
const setup = async (c = codec) => {
  const repo = createRepository(c);
  const doc = await repo.create("owner", "d", old, "private");
  return { repo, doc };
};
const code = (expected: string) => (error: any) => error.code === expected;
test("agent pull → inspect → edit → push → stale conflict → historical context", async () => {
  const { repo, doc } = await setup();
  repo.comment("owner", "d", input(doc.revision));
  const pull = repo.pull("owner", "d");
  assert.match(pull.source, /Before/);
  assert.match(pull.source, /data-pagegi-id="title"/);
  assert.equal(repo.inspect("owner", "d")[0].body, "Please edit heading");
  const pushed = await repo.push(
    "owner",
    "d",
    pull.revision,
    pull.source.replace("Before", "After"),
  );
  assert.notEqual(pushed.revision, pull.revision);
  assert.match(pushed.source, /data-pagegi-id="title"/);
  await assert.rejects(
    repo.push("owner", "d", pull.revision, third),
    code("CONFLICT"),
  );
  assert.equal(repo.pull("owner", "d").source, next);
  const context = repo.context("owner", "d", "c1");
  assert.equal(context.source.source, old);
  assert.deepEqual(context.comment.snapshot, { count: 2 });
});
test("all private source representations and context deny outsiders", async () => {
  const { repo, doc } = await setup();
  repo.comment("owner", "d", input(doc.revision));
  for (const actor of [null, "stranger"])
    for (const read of [
      () => repo.pull(actor, "d"),
      () => repo.pull(actor, "d", doc.revision),
      () => repo.inspect(actor, "d"),
      () => repo.context(actor, "d", "c1"),
    ])
      assert.throws(read, code("DENIED"));
  await assert.rejects(
    repo.push("stranger", "d", doc.revision, next),
    code("DENIED"),
  );
  assert.throws(
    () => repo.comment("stranger", "d", input(doc.revision)),
    code("DENIED"),
  );
});
test("readability does not grant mutation; revocation applies to old revisions", async () => {
  const { repo, doc } = await setup();
  for (const mode of ["public", "unlisted"] as const) {
    repo.share("owner", "d", mode, []);
    assert.equal(repo.pull(null, "d").source, old);
    await assert.rejects(
      repo.push("stranger", "d", doc.revision, next),
      code("DENIED"),
    );
  }
  repo.share("owner", "d", "private", ["editor"]);
  assert.equal(repo.pull("editor", "d").source, old);
  repo.share("owner", "d", "private", []);
  assert.throws(() => repo.pull("editor", "d", doc.revision), code("DENIED"));
});
test("competing expected-revision pushes commit exactly one", async () => {
  const { repo, doc } = await setup();
  const results = await Promise.allSettled([
    repo.push("owner", "d", doc.revision, next),
    repo.push("owner", "d", doc.revision, third),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      (x) => x.status === "rejected" && x.reason.code === "CONFLICT",
    ).length,
    1,
  );
});
test("permission is rechecked after asynchronous normalization", async () => {
  let release!: () => void;
  let gate = false;
  const c = {
    async decode(s: string) {
      if (gate) await new Promise<void>((r) => (release = r));
      return codec.decode(s);
    },
  };
  const { repo, doc } = await setup(c);
  repo.share("owner", "d", "private", ["editor"]);
  gate = true;
  const push = repo.push("editor", "d", doc.revision, next);
  repo.share("owner", "d", "private", []);
  release();
  await assert.rejects(push, code("DENIED"));
  assert.equal(repo.pull("owner", "d").source, old);
});
test("invalid source rollback preserves current and historical views", async () => {
  const { repo, doc } = await setup();
  await assert.rejects(repo.push("owner", "d", doc.revision, "bad source"));
  assert.equal(repo.pull("owner", "d").source, old);
  assert.equal(repo.pull("owner", "d", doc.revision).source, old);
});
test("unknown historical revision never substitutes current content", async () => {
  const { repo } = await setup();
  assert.throws(
    () => repo.pull("owner", "d", "missing"),
    code("HISTORY_UNAVAILABLE"),
  );
  assert.throws(
    () => repo.comment("owner", "d", input("missing")),
    code("HISTORY_UNAVAILABLE"),
  );
  assert.equal(repo.inspect("owner", "d").length, 0);
});
test("duplicate comments are idempotent and changed retry cannot overwrite", async () => {
  const { repo, doc } = await setup();
  const a = repo.comment("owner", "d", input(doc.revision));
  assert.deepEqual(repo.comment("owner", "d", input(doc.revision)), a);
  assert.throws(
    () =>
      repo.comment("owner", "d", { ...input(doc.revision), body: "changed" }),
    code("IDEMPOTENCY_CONFLICT"),
  );
  assert.equal(repo.inspect("owner", "d").length, 1);
});
test("untrusted author field is ignored, retry key cannot be taken by another actor", async () => {
  const { repo, doc } = await setup();
  repo.share("owner", "d", "private", ["editor"]);
  const c = repo.comment("owner", "d", {
    ...input(doc.revision),
    author: "victim",
  } as any);
  assert.equal(c.author, "owner");
  assert.throws(
    () => repo.comment("editor", "d", input(doc.revision)),
    code("IDEMPOTENCY_CONFLICT"),
  );
});
test("repository snapshots own their values, invalid JSON leaves no comment", async () => {
  const { repo, doc } = await setup();
  const i = input(doc.revision);
  const result = repo.comment("owner", "d", i);
  i.snapshot.count = 99;
  (result.snapshot as any).count = 100;
  assert.deepEqual(repo.context("owner", "d", "c1").comment.snapshot, {
    count: 2,
  });
  for (const snapshot of [
    NaN,
    undefined,
    new Date(),
    { x: Infinity },
    (() => {
      const x: any = {};
      x.x = x;
      return x;
    })(),
  ])
    assert.throws(
      () =>
        repo.comment("owner", "d", {
          ...input(doc.revision),
          id: "invalid",
          snapshot,
        }),
      code("INVALID"),
    );
  assert.equal(repo.inspect("owner", "d").length, 1);
});
test("duplicate create does not overwrite source, sharing requires owner", async () => {
  const { repo } = await setup();
  await assert.rejects(
    repo.create("stranger", "d", next, "public"),
    code("CONFLICT"),
  );
  assert.throws(
    () => repo.share("stranger", "d", "public", []),
    code("DENIED"),
  );
  assert.equal(repo.pull("owner", "d").source, old);
});
test("bridge rejects callbacks from replaced and suspended sessions", () => {
  const bridge = createBridge();
  let count = 0;
  const first = bridge.attach();
  assert.equal(
    bridge.accept(first, () => count++),
    true,
  );
  const second = bridge.attach();
  assert.equal(
    bridge.accept(first, () => count++),
    false,
  );
  bridge.suspend();
  assert.equal(
    bridge.accept(second, () => count++),
    false,
  );
  const third = bridge.attach();
  assert.equal(
    bridge.accept(third, () => count++),
    true,
  );
  assert.equal(count, 2);
});
