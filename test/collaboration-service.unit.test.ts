import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollaborationService } from "../src/server/collaboration.ts";
import { createIdentityAuthority } from "../src/server/identity.ts";
import { createPublication } from "../src/model.ts";
import { hash, revision } from "../src/document.js";
import type { ServerState, PresenceEntry } from "../src/contracts.ts";
function fixture() {
  let db: ServerState = {
    accounts: { alice: {} },
    tokens: {},
    files: {},
    publications: {},
  };
  db = createPublication(
    db,
    "alice",
    {
      source: "<h1>hello</h1>",
      requestId: "r",
      visibility: "unlisted",
      linkRole: "viewer",
    },
    { fileId: "doc", share: "share", digest: hash, revision },
  ).state;
  const authority = createIdentityAuthority();
  const issued = authority.issue("alice");
  const credential = issued.credential;
  db.tokens[issued.tokenHash] = issued.session;
  let failed = false;
  let currentTime = 100;
  let beforeTransaction: (() => void) | undefined;
  let active = false;
  const presence = new Map<string, Record<string, PresenceEntry>>();
  const repository: import("../src/server/collaboration-contracts.ts").CollaborationRepository =
    {
      async authorize(id, hash, operation) {
        return this.run(id, hash, async (context) => ({
          value: await operation(context),
        }));
      },
      async run(id, credentialHash, run) {
        beforeTransaction?.();
        beforeTransaction = undefined;
        active = true;
        try {
          const draft = structuredClone(db);
          const file = draft.files[id]!;
          const result = await run({
            document: {
              id,
              owner: file.owner,
              shareHash: file.shareHash,
              generation: file.generation,
              access: file.access,
              head: file.head,
              sequence: file.sequence,
              share: file.share || null,
              path: file.path || null,
            },
            session: draft.tokens[credentialHash] || null,
            sourceExists: async (revision) =>
              Object.hasOwn(file.sources, revision),
          });
          if (failed) throw Error("commit failed");
          Object.assign(file, result.documentChanges);
          db = draft;
          return result.value;
        } finally {
          active = false;
        }
      },
      async sharedLink() {
        assert.equal(active, false);
        return "/document";
      },
      async profiles() {
        assert.equal(active, false);
        return {};
      },
    };
  return {
    service: createCollaborationService({
      repository,
      authority,
      presence,
      now: () => currentTime,
    }),
    time: (value: number) => {
      currentTime = value;
    },
    beforeTransaction: (run: () => void) => {
      beforeTransaction = run;
    },
    credential,
    db: () => db,
    presence,
    fail: () => {
      failed = true;
    },
  };
}
test("sharing requires account authority, profile reads release transaction, revocation invalidates capabilities", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.execute("doc", "share", { kind: "sharing" }),
    /Sign in/,
  );
  const result = await f.service.execute("doc", f.credential, {
    kind: "sharing",
  });
  assert.equal((result.value as { url: string }).url, "/document");
  await f.service.execute("doc", f.credential, { kind: "profiles" });
  await f.service.execute("doc", f.credential, { kind: "revoke" });
  await assert.rejects(
    f.service.execute("doc", "share", { kind: "permissions" }),
    /revoked/,
  );
});
test("failed durable transaction does not emit presence or return a committed change", async () => {
  const f = fixture();
  f.fail();
  await assert.rejects(
    f.service.execute("doc", f.credential, {
      kind: "update-presence",
      input: { sessionId: "s", sourceRevision: f.db().files.doc!.head },
    }),
    /commit failed/,
  );
  assert.equal(f.presence.size, 0);
  await assert.rejects(
    f.service.execute("doc", f.credential, { kind: "revoke" }),
    /commit failed/,
  );
  assert.equal(f.db().files.doc!.share, "share");
});

test("parallel presence commits preserve both viewers", async () => {
  const f = fixture();
  const sourceRevision = f.db().files.doc!.head;
  await Promise.all(
    ["one", "two"].map((sessionId) =>
      f.service.execute("doc", f.credential, {
        kind: "update-presence",
        input: { sessionId, sourceRevision },
      }),
    ),
  );
  assert.deepEqual(Object.keys(f.presence.get("doc")!).sort(), ["one", "two"]);
});

test("public viewers and scoped document grants retain distinct collaboration privileges", async () => {
  const f = fixture();
  f.db().files.doc!.access!.visibility = "public";
  assert.equal(
    (
      (await f.service.execute("doc", "", { kind: "permissions" })).value as {
        read: boolean;
      }
    ).read,
    true,
  );
  const authority = createIdentityAuthority();
  const issued = authority.issue("alice", "doc", f.db().files.doc!.generation);
  f.db().tokens[issued.tokenHash] = { ...issued.session, purpose: "document" };
  await assert.rejects(
    f.service.execute("doc", issued.credential, { kind: "sharing" }),
    { status: 401 },
  );
  await f.service.execute("doc", f.credential, { kind: "revoke" });
  await assert.rejects(
    f.service.execute("doc", issued.credential, { kind: "permissions" }),
    { status: 403 },
  );
});

test("presence checks historical source availability before committing an ephemeral snapshot", async () => {
  const f = fixture();
  const missing = "missing";
  await assert.rejects(
    f.service.execute("doc", f.credential, {
      kind: "update-presence",
      input: {
        sessionId: "s",
        sourceRevision: missing,
        snapshot: {
          sourceRevision: missing,
          schema: 1,
          state: {},
          view: { x: 0, y: 0 },
        },
      },
    }),
    { status: 409 },
  );
  assert.equal(f.presence.size, 0);
  const revision = f.db().files.doc!.head;
  await f.service.execute("doc", f.credential, {
    kind: "update-presence",
    input: {
      sessionId: "s",
      sourceRevision: revision,
      snapshot: {
        sourceRevision: revision,
        schema: 1,
        state: {},
        view: { x: 0, y: 0 },
      },
    },
  });
  assert.equal(f.presence.get("doc")!.s!.snapshot!.sourceRevision, revision);
});

test("editors cannot change policy or revoke the share capability", async () => {
  const f = fixture();
  const issued = createIdentityAuthority().issue("editor@example.com");
  f.db().tokens[issued.tokenHash] = issued.session;
  const file = f.db().files.doc!;
  file.access = {
    visibility: "private",
    linkRole: "viewer",
    shares: { "editor@example.com": "editor" },
    version: 0,
  };
  for (const command of [
    {
      kind: "change-sharing" as const,
      policy: { ...file.access, visibility: "public" as const },
      expectedVersion: 0,
    },
    { kind: "revoke" as const },
  ])
    await assert.rejects(f.service.execute("doc", issued.credential, command), {
      status: 403,
    });
  assert.equal(f.db().files.doc!.generation, file.generation);
  assert.equal(f.db().files.doc!.shareHash, file.shareHash);
  assert.deepEqual(f.db().files.doc!.access, file.access);
});
