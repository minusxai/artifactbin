import type { Account, EmailChallenge } from "../identity-data-contracts.ts";
import type {
  AccountProfileRecord,
  IdentityRepository,
  IssuedSession,
} from "../server/identity-repository-contracts.ts";
import type { SqlClient, SqlDatabase } from "./sql.ts";
import { loadSession } from "./document-records.ts";
function account(row: Record<string, unknown>): Account {
  return {
    ...(row.salt == null ? {} : { salt: String(row.salt) }),
    ...(row.password == null ? {} : { password: String(row.password) }),
    ...(row.name == null ? {} : { name: String(row.name) }),
    ...(row.image == null ? {} : { image: String(row.image) }),
  };
}
function profile(row: Record<string, unknown>): AccountProfileRecord {
  return {
    name: row.name == null ? null : String(row.name),
    image: row.image == null ? null : String(row.image),
  };
}
async function readAccount(
  c: SqlClient,
  actor: string,
): Promise<Account | null> {
  const row = (
    await c.query(
      "SELECT salt,password,name,image FROM accounts WHERE actor=$1",
      [actor],
    )
  ).rows[0];
  return row ? account(row) : null;
}
async function lockAccount(c: SqlClient, actor: string): Promise<void> {
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':account:' || $1,0))",
    [actor],
  );
}
async function insertSession(
  c: SqlClient,
  issued: IssuedSession | undefined,
): Promise<void> {
  if (!issued) return;
  const s = issued.session;
  await c.query(
    "INSERT INTO sessions(token_hash,actor,file_id,generation,expires,purpose,backend_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      issued.tokenHash,
      s.actor,
      s.fileId,
      s.generation,
      s.expires,
      s.purpose ?? null,
      s.backendVersion ?? null,
    ],
  );
}
async function insertAccount(
  c: SqlClient,
  actor: string,
  value: Account,
): Promise<boolean> {
  return (
    (
      await c.query(
        "INSERT INTO accounts(actor,salt,password,name,image) VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor) DO NOTHING",
        [
          actor,
          value.salt ?? null,
          value.password ?? null,
          value.name ?? null,
          value.image ?? null,
        ],
      )
    ).rowCount === 1
  );
}
function challenge(row: Record<string, unknown>): EmailChallenge {
  return {
    digest: String(row.digest),
    salt: String(row.salt),
    expires: Number(row.expires),
    attempts: Number(row.attempts),
    sentAt: Number(row.sent_at),
    windowStart: Number(row.window_start),
    sends: Number(row.sends),
  };
}
export function createIdentityRepository(sql: SqlDatabase): IdentityRepository {
  return {
    readSession: (tokenHash) =>
      sql.transaction((c) => loadSession(c, tokenHash)),
    createAccount: (actor, value) =>
      sql.transaction(async (c) => {
        await lockAccount(c, actor);
        return insertAccount(c, actor, value);
      }),
    withPasswordAccount: (actor, operation) =>
      sql.transaction(async (c) => {
        await lockAccount(c, actor);
        const result = await operation({
          account: await readAccount(c, actor),
        });
        await insertSession(c, result.issued);
        return result.value;
      }),
    withEmailChallenge: (email, operation) =>
      sql.transaction(async (c) => {
        // Shared account lock serializes password creation, profile updates and email account creation.
        await lockAccount(c, email);
        const row = (
          await c.query(
            "SELECT digest,salt,expires,attempts,sent_at,window_start,sends FROM email_challenges WHERE email=$1 FOR UPDATE",
            [email],
          )
        ).rows[0];
        const result = await operation({
          account: await readAccount(c, email),
          challenge: row ? challenge(row) : null,
        });
        if (result.challenge) {
          const v = result.challenge;
          await c.query(
            "INSERT INTO email_challenges(email,digest,salt,expires,attempts,sent_at,window_start,sends) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(email) DO UPDATE SET digest=excluded.digest,salt=excluded.salt,expires=excluded.expires,attempts=excluded.attempts,sent_at=excluded.sent_at,window_start=excluded.window_start,sends=excluded.sends",
            [
              email,
              v.digest,
              v.salt,
              v.expires,
              v.attempts,
              v.sentAt,
              v.windowStart,
              v.sends,
            ],
          );
        }
        if (result.createAccount)
          await insertAccount(c, email, result.createAccount);
        await insertSession(c, result.issued);
        return result.value;
      }),
    readProfile: (actor) =>
      sql.transaction(async (c) => {
        const row = (
          await c.query("SELECT name,image FROM accounts WHERE actor=$1", [
            actor,
          ])
        ).rows[0];
        return row ? profile(row) : null;
      }),
    updateProfile: (actor, value) =>
      sql.transaction(async (c) => {
        await lockAccount(c, actor);
        const row = (
          await c.query(
            "UPDATE accounts SET name=$2,image=$3 WHERE actor=$1 RETURNING name,image",
            [actor, value.name, value.image],
          )
        ).rows[0];
        return row ? profile(row) : null;
      }),
    revokeSession: (tokenHash) =>
      sql.transaction(async (c) => {
        await c.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash]);
      }),
  };
}
