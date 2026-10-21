/**
 * Account secrets (contract: ./secrets-contracts.ts): the key, AES-256-GCM at
 * rest with the account and name as associated data, the account_secrets
 * table, and the /api/secrets routes. Values cross this module only on the way
 * in (PUT) and on the way to a lambda's `env`; no route ever returns one.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fail } from "../errors.ts";
import type { SqlClient, SqlDatabase } from "../backend/af-backend-contracts.ts";
import type { AfRouteModule } from "./af-api-contracts.ts";
import {
  MAX_SECRETS_PER_ACCOUNT,
  SECRET_VALUE_MAX_BYTES,
  SECRETS_KEY_BYTES,
  SECRETS_NOT_CONFIGURED,
  type BackendEnv,
  type SecretCipher,
  type SecretsStore,
  type SecretSummary,
} from "./secrets-contracts.ts";

import { validSecretName, validSecretValue } from "../backend/container/env-policy.mjs";

const KEY_ERROR = `PAGEGI_SECRETS_KEY must be ${SECRETS_KEY_BYTES} bytes as base64 or hex`;
const NAME_ERROR =
  "A secret name is 1 to 64 characters: a capital letter, then capitals, digits and underscores";
const VALUE_ERROR = `A secret value is 1 to ${SECRET_VALUE_MAX_BYTES} bytes of text without NUL characters`;
const FULL_ERROR = `An account keeps at most ${MAX_SECRETS_PER_ACCOUNT} secrets; remove one first`;
const VERSION = "v1";
const ROUTE = /^\/api\/secrets(?:\/([^/]+))?$/;

export function parseSecretsKey(text: string): Uint8Array {
  const trimmed = text.trim();
  let bytes: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) bytes = Buffer.from(trimmed, "hex");
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed))
    bytes = Buffer.from(trimmed.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  else throw Error(KEY_ERROR);
  if (bytes.length !== SECRETS_KEY_BYTES) throw Error(KEY_ERROR);
  return new Uint8Array(bytes);
}

export function createSecretCipher(key: Uint8Array): SecretCipher {
  if (key.length !== SECRETS_KEY_BYTES) throw Error(KEY_ERROR);
  const secret = Buffer.from(key);
  const associated = (actor: string, name: string) =>
    Buffer.from(`${actor}\0${name}`, "utf8");
  return {
    seal(actor, name, value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, iv);
      cipher.setAAD(associated(actor, name));
      const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return [VERSION, iv, data, cipher.getAuthTag()]
        .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
        .join(".");
    },
    open(actor, name, ciphertext) {
      const [version, iv, data, tag] = ciphertext.split(".");
      if (version !== VERSION || !iv || !data || !tag)
        throw Error("Secret cannot be opened");
      try {
        const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64url"));
        decipher.setAAD(associated(actor, name));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        throw Error("Secret cannot be opened");
      }
    },
  };
}

const summary = (row: Record<string, unknown>): SecretSummary => ({
  name: String(row.name),
  updatedAt: new Date(Number(row.updated_at)).toISOString(),
});

export function createSecretsStore(options: {
  cipher: SecretCipher;
  now?: () => number;
}): SecretsStore {
  const { cipher, now = Date.now } = options;
  return {
    async list(client, actor) {
      const { rows } = await client.query(
        `SELECT name, updated_at FROM account_secrets WHERE actor = $1 ORDER BY name`,
        [actor],
      );
      return rows.map(summary);
    },
    async set(client, actor, name, value) {
      if (!validSecretName(name)) fail(422, NAME_ERROR);
      if (!validSecretValue(value))
        fail(422, VALUE_ERROR);
      // One writer per account at a time, so the count below is exact.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('account_secrets:' || $1, 0))`, [actor]);
      const { rows: counted } = await client.query(
        `SELECT count(*)::int AS n FROM account_secrets WHERE actor = $1 AND name <> $2`,
        [actor, name],
      );
      if (Number(counted[0]?.n) >= MAX_SECRETS_PER_ACCOUNT) fail(422, FULL_ERROR);
      const time = now();
      const { rows } = await client.query(
        `INSERT INTO account_secrets (actor, name, ciphertext, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (actor, name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = EXCLUDED.updated_at
         RETURNING name, updated_at`,
        [actor, name, cipher.seal(actor, name, value), time],
      );
      return summary(rows[0]!);
    },
    async remove(client, actor, name) {
      const { rowCount } = await client.query(
        `DELETE FROM account_secrets WHERE actor = $1 AND name = $2`,
        [actor, name],
      );
      return Boolean(rowCount);
    },
    async env(client, owner) {
      const { rows } = await client.query(
        `SELECT name, ciphertext FROM account_secrets WHERE actor = $1 ORDER BY name`,
        [owner],
      );
      const env: Record<string, string> = Object.create(null);
      for (const row of rows)
        env[String(row.name)] = cipher.open(owner, String(row.name), String(row.ciphertext));
      return Object.freeze({ ...env }) as BackendEnv;
    },
  };
}

const reply = (status: number, body: unknown) => ({ status, body });

export function createSecretsRoutes(options: {
  database: SqlDatabase;
  actor(credential: string): Promise<string>;
  store?: SecretsStore;
}): AfRouteModule {
  const { database, actor, store } = options;
  return {
    async handle(request) {
      const match = ROUTE.exec(request.url.pathname);
      if (!match) return null;
      if (!store) return reply(503, { error: SECRETS_NOT_CONFIGURED });
      const name = match[1] === undefined ? null : decodeURIComponent(match[1]);
      const method = request.method;
      if (name === null ? method !== "GET" : method !== "PUT" && method !== "DELETE")
        return reply(405, { error: name === null ? "Use GET for this route" : "Use PUT or DELETE for this route" });
      const who = await actor(request.credential);
      return database.transaction(async (client: SqlClient) => {
        if (name === null) return reply(200, { secrets: await store.list(client, who) });
        if (method === "PUT") return reply(200, await store.set(client, who, name, request.body?.value));
        if (!(await store.remove(client, who, name))) return reply(404, { error: `No secret named ${name}` });
        return reply(200, { name, deleted: true });
      });
    },
  };
}
