import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountActor,
  newPasswordAccount,
  passwordAccount,
  passwordAttempts,
} from "../src/server/identity-policy.ts";
import type { IdentityCrypto } from "../src/server/identity-repository-contracts.ts";
const crypto: IdentityCrypto = {
  token: () => "salt",
  code: () => "123456",
  digest: (value) => value,
  passwordDigest: (password, salt) => `${salt}:${password}`,
  equalDigest: (actual, expected) => actual === expected,
};
test("account sessions expire at the boundary and scoped purposes cannot become account sessions", () => {
  const session = {
    actor: "alice",
    fileId: null,
    generation: null,
    expires: 100,
  };
  assert.equal(accountActor(session, 99), "alice");
  assert.throws(() => accountActor(session, 100), /Sign in/);
  assert.throws(() => accountActor(null, 0), /Sign in/);
  assert.throws(
    () => accountActor({ ...session, purpose: "backend" }, 0),
    /Sign in/,
  );
});
test("password policy validates new accounts and verifies missing accounts with injected crypto", () => {
  assert.throws(() => newPasswordAccount("a", "long-password", crypto), /2–40/);
  const account = newPasswordAccount("alice", "long-password", crypto);
  passwordAccount(account, "long-password", crypto);
  assert.throws(() => passwordAccount(account, "wrong", crypto), /Incorrect/);
  assert.throws(
    () => passwordAccount(null, "long-password", crypto),
    /Incorrect/,
  );
});
test("password attempt policy separates peers and resets only after the complete minute", () => {
  const attempt = passwordAttempts();
  for (let i = 0; i < 15; i++) attempt("one", 0);
  assert.throws(() => attempt("one", 60000), /Wait/);
  attempt("two", 60000);
  attempt("one", 60001);
});
