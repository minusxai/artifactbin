import test from "node:test";
import assert from "node:assert/strict";
import { createIdentityAuthority } from "../src/server/identity.ts";
import { accountActor } from "../src/server/identity-policy.ts";
import {
  authorizeDocument,
  authorizePageRead,
} from "../src/server/document-authorization.ts";
const actors = ["user", "token", "orphan"].map(
  (kind) => `legacy-${kind}:${"a".repeat(64)}`,
);
const identity = createIdentityAuthority({ now: () => 100 });
test("archival principals cannot acquire or replay account or document sessions", () => {
  for (const actor of actors) {
    assert.throws(() => identity.issue(actor), /Sign in/);
    const session = { actor, fileId: null, generation: null, expires: 200 };
    assert.throws(() => accountActor(session, 100), /Sign in/);
    const document = {
      owner: actor,
      shareHash: "link",
      generation: 1,
      head: "1",
      access: {
        visibility: "private" as const,
        linkRole: "viewer" as const,
        shares: {},
        version: 0,
      },
    };
    assert.throws(
      () =>
        authorizeDocument({
          document,
          session,
          credentialHash: "old-account",
          fileId: "Page12",
          now: 100,
        }),
      /expired|revoked|access/i,
    );
    assert.throws(
      () =>
        authorizePageRead({ document, session, fileId: "Page12", now: 100 }),
      /expired|revoked|access/i,
    );
  }
});
test("real migrated login actors and explicit scoped guests retain their session behavior", () => {
  const login = identity.issue("reader@example.test").session;
  assert.equal(identity.account(login), "reader@example.test");
  const guest = identity.issue("guest:synthetic", "Page12", 1).session;
  const document = {
    owner: "reader@example.test",
    shareHash: "link",
    generation: 1,
    head: "1",
    access: {
      visibility: "unlisted" as const,
      linkRole: "viewer" as const,
      shares: {},
      version: 0,
    },
  };
  assert.equal(
    authorizeDocument({
      document,
      session: guest,
      credentialHash: "scoped",
      fileId: "Page12",
      now: 100,
    }).permissions.read,
    true,
  );
  assert.throws(() => identity.account(guest), /Sign in/);
});
