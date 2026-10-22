import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { createIdentityAuthority } from "../src/server/identity.ts";
import { createAuthenticationService } from "../src/server/authentication.ts";
import type {
  Account,
  EmailChallenge,
  SessionGrant,
} from "../src/identity-data-contracts.ts";
interface IdentityFixtureState {
  accounts: Record<string, Account>;
  tokens: Record<string, SessionGrant>;
  emailChallenges?: Record<string, EmailChallenge>;
}
import type { IdentityRepository } from "../src/server/identity-repository-contracts.ts";
import { hash } from "../src/document.js";
const fixture = () => {
  let state: IdentityFixtureState = {
    accounts: {
      alice: {
        salt: "salt",
        password: scryptSync("correct-password", "salt", 64).toString("hex"),
      },
    },
    tokens: {},
  };
  let rejectCommit = false;
  const commit = <T>(draft: IdentityFixtureState, value: T): T => {
    if (rejectCommit) throw Error("commit failed");
    state = draft;
    return value;
  };
  const repository: IdentityRepository = {
    async withPasswordAccount(actor, work) {
      const draft = structuredClone(state);
      const result = await work({ account: draft.accounts[actor] ?? null });
      if (result.issued)
        draft.tokens[result.issued.tokenHash] = result.issued.session;
      return commit(draft, result.value);
    },
    async withEmailChallenge(email, work) {
      const draft = structuredClone(state);
      const result = await work({
        account: draft.accounts[email] ?? null,
        challenge: draft.emailChallenges?.[email] ?? null,
      });
      if (result.challenge)
        (draft.emailChallenges ||= {})[email] = result.challenge;
      if (result.createAccount) draft.accounts[email] = result.createAccount;
      if (result.issued)
        draft.tokens[result.issued.tokenHash] = result.issued.session;
      return commit(draft, result.value);
    },
    async readSession(hash) {
      return state.tokens[hash] ?? null;
    },
    async createAccount(actor, account) {
      if (state.accounts[actor]) return false;
      state.accounts[actor] = account;
      return true;
    },
    async readProfile(actor) {
      const account = state.accounts[actor];
      return account
        ? { name: account.name ?? null, image: account.image ?? null }
        : null;
    },
    async updateProfile(actor, profile) {
      const account = state.accounts[actor];
      if (!account) return null;
      Object.assign(account, profile);
      return { name: account.name ?? null, image: account.image ?? null };
    },
    async revokeSession(hash) {
      delete state.tokens[hash];
    },
  };
  return {
    repository,
    state: () => state,
    reject: () => {
      rejectCommit = true;
    },
  };
};
test("password authentication persists a hashed expiring session and rate limits unsuccessful attempts", async () => {
  const f = fixture();
  let now = 100;
  const authority = createIdentityAuthority({ now: () => now });
  const service = createAuthenticationService({
    repository: f.repository,
    authority,
    now: () => now,
  });
  const result = await service.execute({
    kind: "password",
    username: "alice",
    password: "correct-password",
    peer: "peer",
  });
  assert.equal(result.value.username, "alice");
  assert.equal(
    authority.account(f.state().tokens[hash(result.value.token!)] ?? null),
    "alice",
  );
  assert.ok(!Object.keys(f.state().tokens).includes(result.value.token!));
  for (let i = 0; i < 14; i++)
    await assert.rejects(
      service.execute({
        kind: "password",
        username: "missing",
        password: "bad",
        peer: "peer",
      }),
      /Incorrect/,
    );
  await assert.rejects(
    service.execute({
      kind: "password",
      username: "alice",
      password: "correct-password",
      peer: "peer",
    }),
    /Wait/,
  );
  now += 60001;
  await service.execute({
    kind: "password",
    username: "alice",
    password: "correct-password",
    peer: "peer",
  });
  now += 30 * 86400000;
  assert.throws(
    () =>
      authority.account(f.state().tokens[hash(result.value.token!)] ?? null),
    /Sign in/,
  );
});
test("email delivery follows commit; guesses persist and successful codes are single-use", async () => {
  const f = fixture();
  const sent: { to: string; code: string }[] = [];
  const service = createAuthenticationService({
    repository: f.repository,
    authority: createIdentityAuthority(),
    sendCode: async (m) => {
      assert.ok(f.state().emailChallenges?.[m.to]);
      sent.push(m);
    },
  });
  await service.execute({
    kind: "request-code",
    email: " Alice@Example.test ",
  });
  assert.equal(
    (
      await service.execute({
        kind: "verify-code",
        email: "alice@example.test",
        code: "bad",
      })
    ).status,
    401,
  );
  assert.equal(f.state().emailChallenges?.["alice@example.test"]?.attempts, 1);
  const verified = await service.execute({
    kind: "verify-code",
    email: sent[0]!.to,
    code: sent[0]!.code,
  });
  assert.ok(verified.value.token);
  assert.equal(
    (
      await service.execute({
        kind: "verify-code",
        email: sent[0]!.to,
        code: sent[0]!.code,
      })
    ).status,
    401,
  );
  const failed = fixture();
  failed.reject();
  await assert.rejects(
    createAuthenticationService({
      repository: failed.repository,
      authority: createIdentityAuthority(),
      sendCode: async (m) => {
        sent.push(m);
      },
    }).execute({ kind: "request-code", email: "other@example.test" }),
    /commit failed/,
  );
  assert.equal(sent.length, 1);
});
test("disabled sign-in and delivery failures never report successful authentication", async () => {
  const f = fixture();
  const authority = createIdentityAuthority();
  const service = createAuthenticationService({
    repository: f.repository,
    authority,
    allowPasswordLogin: false,
  });
  await assert.rejects(
    service.execute({
      kind: "password",
      username: "alice",
      password: "correct-password",
      peer: "peer",
    }),
    /disabled/,
  );
  await assert.rejects(
    service.execute({ kind: "request-code", email: "alice@example.test" }),
    /not configured/,
  );
  await assert.rejects(
    createAuthenticationService({
      repository: f.repository,
      authority,
      sendCode: async () => {
        throw Error("provider");
      },
    }).execute({ kind: "request-code", email: "alice@example.test" }),
    /delivery failed/,
  );
  assert.ok(f.state().emailChallenges?.["alice@example.test"]);
});

test("account service creates unique password accounts, normalizes profiles and revokes account sessions", async () => {
  const { createAccountService } = await import(
    "../src/server/account-service.ts"
  );
  const f = fixture();
  const authority = createIdentityAuthority({ now: () => 10 });
  const service = createAccountService({ repository: f.repository, authority });
  await service.add("bob", "correct-password");
  await assert.rejects(
    service.add("bob", "another-password"),
    /already exists/,
  );
  await assert.rejects(service.add("b", "short"), /2–40/);
  assert.deepEqual(await service.profile("bob"), { name: "bob", image: null });
  assert.deepEqual(
    await service.profile("bob", { name: " Bob ", image: null }),
    { name: "Bob", image: null },
  );
  await assert.rejects(
    service.profile("bob", { name: "x", image: "https://example.test/photo" }),
    /PNG/,
  );
  await assert.rejects(service.profile("absent"), /Sign in/);
  const issued = authority.issue("bob");
  f.state().tokens[issued.tokenHash] = issued.session;
  assert.equal(await service.actor(issued.tokenHash), "bob");
  await service.revoke(issued.tokenHash);
  await assert.rejects(service.actor(issued.tokenHash), /Sign in/);
});

test("injected code generation and clock preserve leading zeroes and exact expiry", async () => {
  const { identityCrypto } = await import("../src/server/identity-policy.ts");
  const f = fixture();
  let now = 0;
  const sent: string[] = [];
  const crypto = {
    ...identityCrypto,
    token: () => "deterministic-salt",
    code: () => "000007",
  };
  const service = createAuthenticationService({
    repository: f.repository,
    authority: createIdentityAuthority({ now: () => now, crypto }),
    crypto,
    now: () => now,
    sendCode: async ({ code }) => {
      sent.push(code);
    },
  });
  await service.execute({ kind: "request-code", email: "test@example.test" });
  assert.deepEqual(sent, ["000007"]);
  now = 600000;
  const expired = await service.execute({
    kind: "verify-code",
    email: "test@example.test",
    code: "000007",
  });
  assert.equal(expired.status, 401);
  assert.equal(f.state().emailChallenges!["test@example.test"]!.attempts, 1);
  assert.equal(f.state().accounts["test@example.test"], undefined);
});

test("untrusted password usernames cannot become repository identities and disabled login wins", async () => {
  const f = fixture(),
    authority = createIdentityAuthority();
  const service = createAuthenticationService({
    repository: f.repository,
    authority,
  });
  for (const username of [null, 42, ["alice"], { username: "alice" }])
    await assert.rejects(
      service.execute({
        kind: "password",
        username,
        password: "correct-password",
        peer: "malformed",
      }),
      { status: 401, message: "Incorrect username or password" },
    );
  assert.deepEqual(f.state().tokens, {});
  await assert.rejects(
    createAuthenticationService({
      repository: f.repository,
      authority,
      allowPasswordLogin: false,
    }).execute({
      kind: "password",
      username: [],
      password: "correct-password",
      peer: "disabled",
    }),
    { status: 404, message: "Password sign-in is disabled" },
  );
});
