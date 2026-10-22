import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { database } from "../src/database.js";
import { insertPages } from "./fixtures/pages.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import {
  loadSession,
  loadDocumentHeader,
  lockDocumentHeader,
} from "../src/persistence/document-records.ts";
test("shared record readers load complete scalar headers and sessions, and distinguish missing records", async () => {
  const env = await testDatabase(),
    legacy = database(env);
  try {
    {
      const state = { accounts: {}, tokens: {}, files: {}, publications: {} };
      state.accounts.owner = {};
      state.tokens.token = {
        actor: "owner",
        fileId: "File01",
        generation: 3,
        expires: 123456,
        purpose: "backend",
        backendVersion: "v1",
      };
      state.files.File01 = {
        owner: "owner",
        shareHash: "hash",
        generation: 3,
        head: "1",
        sequence: 7,
        share: "link",
        path: "document.html",
        access: {
          visibility: "private",
          linkRole: "viewer",
          shares: {},
          version: 1,
        },
        sources: { 1: "<p>content</p>" },
        comments: {},
        snapshots: {},
        seed: { secret: "excluded" },
      };
      await legacy.health();
      await insertPages(env.pool, state);
    }
    const sql = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
      lockTimeoutMs: 5000,
    });
    const competing = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
      lockTimeoutMs: 40,
    });
    const principalSpace = (await env.pool.query("SELECT space FROM accounts WHERE actor='owner'")).rows[0].space;
    assert.equal(typeof principalSpace, "string");
    assert.match(principalSpace, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    await sql.transaction(async (c) => {
      assert.deepEqual(await loadSession(c, "token"), {
        actor: "owner",
        fileId: "File01",
        generation: 3,
        expires: 123456,
        purpose: "backend",
        backendVersion: "v1",
        principalSpace,
        groupAuthority: { actor: "owner", memberships: [] },
      });
      assert.equal(await loadSession(c, "missing"), null);
      assert.equal(await loadDocumentHeader(c, "missing"), null);
      assert.equal(await lockDocumentHeader(c, "missing"), null);
      const expected = {
        id: "File01",
        owner: "owner",
        ownerKind: "user",
        shareHash: "hash",
        generation: 3,
        head: "1",
        sequence: 7,
        share: "link",
        path: "document.html",
        sourceDigest: null,
        access: {
          visibility: "private",
          linkRole: "viewer",
          shares: {},
          version: 1,
        },
      };
      assert.deepEqual(await loadDocumentHeader(c, "File01"), expected);
      // An ordinary read leaves the header writable by another transaction.
      await competing.transaction(async (other) => {
        await other.query("UPDATE files SET sequence=sequence WHERE id='File01'");
      });
      assert.deepEqual(await lockDocumentHeader(c, "File01"), expected);
      // Header and credential locks are real PostgreSQL locks, not SQL snapshots.
      await assert.rejects(
        competing.transaction(async (other) => {
          await other.query(
            "UPDATE files SET sequence=sequence WHERE id='File01'",
          );
        }),
        (error) => error.code === "55P03",
      );
      await assert.rejects(
        competing.transaction(async (other) => {
          await other.query(
            "UPDATE sessions SET expires=expires WHERE token_hash='token'",
          );
        }),
        (error) => error.code === "55P03",
      );
      assert.equal(
        (await c.query("SHOW statement_timeout")).rows[0].statement_timeout,
        "15s",
      );
      assert.equal(
        (await c.query("SHOW lock_timeout")).rows[0].lock_timeout,
        "5s",
      );
    });
    await sql.transaction(async (c) => {
      await c.query("UPDATE files SET sequence=8 WHERE id='File01'");
    });
    await assert.rejects(
      sql.transaction(async (c) => {
        await c.query("UPDATE files SET sequence=99 WHERE id='File01'");
        throw Error("abort");
      }),
      /abort/,
    );
    assert.equal(
      await sql.transaction(
        async (c) => (await loadDocumentHeader(c, "File01")).sequence,
      ),
      8,
    );
  } finally {
    await legacy.close();
    await env.cleanup();
  }
});
