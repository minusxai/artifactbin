import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createIdentityRepository } from "../src/persistence/identity-repository.ts";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test("identity operations preserve unique accounts, atomically commit challenges and sessions, and revoke durable credentials", async () => {
  const env = await testDatabase();
  try {
    await env.pool.query(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    const sql = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
      lockTimeoutMs: 5000,
    });
    const repository = createIdentityRepository(sql);
    assert.equal(await repository.readSession("absent"), null);
    assert.equal(await repository.readProfile("absent"), null);
    assert.equal(
      await repository.updateProfile("absent", { name: "name", image: null }),
      null,
    );
    const created = await Promise.all([
      repository.createAccount("alice", { salt: "a", password: "a" }),
      repository.createAccount("alice", { salt: "b", password: "b" }),
    ]);
    assert.deepEqual(created.sort(), [false, true]);
    const session = {
      actor: "alice",
      fileId: null,
      generation: null,
      expires: 100,
    };
    const challenge = {
      digest: "code",
      salt: "salt",
      expires: 100,
      attempts: 0,
      sentAt: 1,
      windowStart: 1,
      sends: 1,
    };
    await repository.withEmailChallenge("alice", ({ challenge: missing }) => {
      assert.equal(missing, null);
      return {
        challenge,
        issued: { credential: "raw-secret", tokenHash: "hashed", session },
        value: "committed",
      };
    });
    const principalSpace = (await env.pool.query("SELECT space FROM accounts WHERE actor='alice'")).rows[0].space;
    assert.equal(typeof principalSpace, "string");
    assert.match(principalSpace, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    const expectedSession = {...session, principalSpace, groupAuthority:{actor:session.actor,memberships:[]}};
    assert.deepEqual(await repository.readSession("hashed"), expectedSession);
    assert.deepEqual(await repository.readSession("hashed"), expectedSession,
      "reloading a session preserves its current account incarnation");
    assert.equal(await repository.readSession("raw-secret"), null);
    await assert.rejects(
      repository.withEmailChallenge("other", () => ({
        challenge,
        issued: { credential: "ignored", tokenHash: "hashed", session },
        createAccount: {},
        value: null,
      })),
      /duplicate key/,
    );
    assert.equal(await repository.readProfile("other"), null);
    await repository.withEmailChallenge("other", ({ challenge }) => {
      assert.equal(challenge, null);
      return { value: null };
    });
    const profile = await repository.updateProfile("alice", {
      name: "Alice",
      image: null,
    });
    assert.equal(profile.name, "Alice");
    assert.equal(profile.password, undefined);
    await repository.withPasswordAccount("alice", ({ account }) => {
      assert.ok(account.password);
      return { value: null };
    });
    await repository.revokeSession("hashed");
    assert.equal(await repository.readSession("hashed"), null);
    await env.pool.query("DELETE FROM accounts WHERE actor='alice'");
    assert.equal(await repository.createAccount("alice", {}), true);
    const recreatedSpace = (await env.pool.query("SELECT space FROM accounts WHERE actor='alice'")).rows[0].space;
    assert.notEqual(recreatedSpace, principalSpace, "a recreated login name is a different principal incarnation");
    await repository.withPasswordAccount("alice", () => ({
      issued:{credential:"replacement-secret",tokenHash:"replacement-hash",session}, value:null,
    }));
    assert.deepEqual(await repository.readSession("replacement-hash"), {
      ...session, principalSpace:recreatedSpace, groupAuthority:{actor:session.actor,memberships:[]},
    });
  } finally {
    await env.cleanup();
  }
});
test("identity locks serialize absent email rows and preserve failed guesses under concurrent verification", async () => {
  const env = await testDatabase();
  const entered = deferred(),
    release = deferred();
  try {
    await env.pool.query(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    const repository = createIdentityRepository(
      createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
        lockTimeoutMs: 5000,
      }),
    );
    const first = repository.withEmailChallenge(
      "alice",
      async ({ challenge }) => {
        assert.equal(challenge, null);
        entered.resolve();
        await release.promise;
        return {
          challenge: {
            digest: "code",
            salt: "salt",
            expires: 100,
            attempts: 1,
            sentAt: 1,
            windowStart: 1,
            sends: 1,
          },
          value: null,
        };
      },
    );
    await entered.promise;
    const second = repository.withEmailChallenge("alice", ({ challenge }) => {
      assert.equal(challenge.attempts, 1);
      return { challenge: { ...challenge, attempts: 2 }, value: null };
    });
    release.resolve();
    await Promise.all([first, second]);
    await repository.withEmailChallenge("alice", ({ challenge }) => {
      assert.equal(challenge.attempts, 2);
      return { value: null };
    });
  } finally {
    release.resolve();
    await env.cleanup();
  }
});
