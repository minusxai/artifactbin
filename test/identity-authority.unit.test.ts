import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentityAuthority } from "../src/server/identity.ts";
import { createPublication } from "../src/model.ts";
import { hash, revision } from "../src/document.js";
import type { ServerState } from "../src/contracts.ts";
test("identity distinguishes account, document, collaboration, backend, and portable read capabilities", () => {
  let now = 100;
  const identity = createIdentityAuthority({ now: () => now });
  let db: ServerState = {
    accounts: { alice: {} },
    tokens: {},
    files: {},
    publications: {},
  };
  db = createPublication(
    db,
    "alice",
    { source: "<p>hello</p>", requestId: "p", visibility: "unlisted" },
    { fileId: "doc", share: "share", digest: hash, revision },
  ).state;
  const issuedAccount = identity.issue("alice");
  const account = issuedAccount.credential;
  db.tokens[issuedAccount.tokenHash] = issuedAccount.session;
  const document = (value: string, id: string) =>
    identity.document(
      {
        document: db.files[id] ?? null,
        session: db.tokens[hash(value)] ?? null,
      },
      value,
      id,
    );
  assert.equal(document(account, "doc").appEdit, true);
  assert.equal(document("share", "doc").actor, null);
  assert.equal(document("share", "doc").appEdit, false);
  assert.throws(() => document("", "doc"), /access/);
  assert.throws(() => document(account, "missing"), /not found/);
  const issuedScoped = identity.issue("alice", "doc", 1);
  const scoped = issuedScoped.credential;
  db.tokens[issuedScoped.tokenHash] = issuedScoped.session;
  db.tokens[hash(scoped)]!.purpose = "collaboration";
  assert.equal(document(scoped, "doc").appEdit, false);
  assert.throws(
    () => identity.account(db.tokens[hash(scoped)] ?? null),
    /Sign in/,
  );
  db.tokens[hash(scoped)]!.purpose = "document";
  const grant = document(scoped, "doc");
  assert.equal(grant.appEdit, true);
  assert.equal(grant.owner, false);
  assert.equal(grant.permissions.manage, false);
  db.tokens[hash(scoped)]!.purpose = "backend";
  assert.throws(() => document(scoped, "doc"), /Backend grants/);
  db.tokens[hash(scoped)]!.purpose = "document";
  db.files.doc!.generation++;
  assert.throws(() => document(scoped, "doc"), /revoked/);
  now += 30 * 86400000;
  assert.throws(() => document(account, "doc"), /expired/);
  assert.throws(
    () => identity.account(db.tokens[hash(account)] ?? null),
    /Sign in/,
  );
});
