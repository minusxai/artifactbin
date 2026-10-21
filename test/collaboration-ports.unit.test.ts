import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollaborationService } from "../src/server/collaboration.ts";
import type {
  CollaborationRepository,
  CollaborationContext,
} from "../src/server/collaboration-contracts.ts";
import { createIdentityAuthority } from "../src/server/identity.ts";
import { hash } from "../src/document.js";

test("collaboration uses the locked document and explicit source existence without state maps", async () => {
  const context: CollaborationContext = {
    document: {
      id: "doc",
      owner: "owner",
      shareHash: hash("link"),
      generation: 1,
      head: "source",
      sequence: 0,
      share: null,
      path: null,
    },
    session: null,
    sourceExists: async () => false,
  };
  let calls = 0;
  const repository: CollaborationRepository = {
    async authorize(id, hash, operation) {
      return this.run(id, hash, async (context) => ({
        value: await operation(context),
      }));
    },
    async run(id, credentialHash, operation) {
      assert.equal(id, "doc");
      assert.equal(credentialHash, hash("link"));
      calls++;
      return (await operation(context)).value;
    },
    sharedLink: async () => null,
    profiles: async () => ({}),
  };
  const service = createCollaborationService({
    repository,
    authority: createIdentityAuthority(),
    presence: new Map(),
  });
  const result = await service.execute("doc", "link", { kind: "permissions" });
  assert.equal((result.value as { read: boolean }).read, true);
  assert.equal(calls, 1);
});

test("live authorization uses the header-only port and explicit historical source availability", async () => {
  const authority = createIdentityAuthority({ now: () => 100 });
  const issued = authority.issue("owner", "doc", 1);
  let sourceQueries = 0;
  const repository: CollaborationRepository = {
    async authorize(id, tokenHash, operation) {
      assert.equal(id, "doc");
      assert.equal(tokenHash, issued.tokenHash);
      return operation({
        document: {
          id: "doc",
          owner: "owner",
          shareHash: hash("link"),
          generation: 1,
          head: "current",
          sequence: 0,
          path: null,
          share: null,
        },
        session: issued.session,
        sourceExists: async (revision) => {
          sourceQueries++;
          return revision === "historical";
        },
      });
    },
    async run() {
      throw Error("Dataset must not be loaded");
    },
    sharedLink: async () => null,
    profiles: async () => ({}),
  };
  const service = createCollaborationService({
    repository,
    authority,
    presence: new Map(),
  });
  const auth = await service.authorizeLive(
    "doc",
    issued.credential,
    "historical",
  );
  assert.equal(auth.actor, "owner");
  assert.equal(auth.sourceAvailable, true);
  assert.equal(auth.sourceRevision, "historical");
  assert.equal(auth.expires, issued.session.expires);
  assert.deepEqual(auth.file, { generation: 1 });
  assert.equal(sourceQueries, 1);
});
