import {PGlite} from '@electric-sql/pglite';
import {Kysely} from 'kysely';
import {afterEach, beforeEach, expect, it} from 'vitest';
import {pgliteDialect} from '../src/auth/pglite';
import {createHumanAuth} from '../src/auth/human';
import {assertHumanAccountSchema, migrateHumanAccountSchema} from '../src/auth/account-migration';

let pg: PGlite;
let db: Kysely<Record<string, unknown>>;
const options = {writesPausedAndBackupVerified: true} as const;
beforeEach(async () => {
  pg = new PGlite(); db = new Kysely({dialect: pgliteDialect(pg)});
  await pg.exec('CREATE SCHEMA auth; CREATE TABLE auth.account (id text PRIMARY KEY, "providerId" text NOT NULL, "accountId" text NOT NULL)');
});
afterEach(async () => {await db.destroy();});
const legacy = async () => {
  await pg.exec(`ALTER TABLE auth.account ADD COLUMN issuer text NOT NULL;
    CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON auth.account (issuer, "accountId");
    INSERT INTO auth.account VALUES ('old', 'provider', 'identity', 'https://example.invalid')`);
};
const schema = () => pg.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='auth' AND table_name='account' ORDER BY column_name`);

it('preserves legacy account/issuer data, removes only the legacy index, and repeats without changes', async () => {
  await legacy();
  await expect(assertHumanAccountSchema(db)).rejects.toThrow('Stop all auth/account writers');
  expect(await migrateHumanAccountSchema(db, options)).toEqual({changed: true});
  expect((await pg.query('SELECT * FROM auth.account')).rows).toEqual([{id:'old',providerId:'provider',accountId:'identity',issuer:'https://example.invalid'}]);
  await pg.exec(`INSERT INTO auth.account (id,"providerId","accountId") VALUES ('new','provider','new-identity')`);
  await expect(assertHumanAccountSchema(db)).resolves.toBeUndefined();
  expect(await migrateHumanAccountSchema(db, options)).toEqual({changed:false});
});
it('accepts pre-issuer 1.6 and fresh 1.7.7 account schemas without adding issuer', async () => {
  const before = await schema();
  expect(await migrateHumanAccountSchema(db, options)).toEqual({changed:false});
  expect(await schema()).toEqual(before);
  await assertHumanAccountSchema(db);
});
it('is a no-op before initial database creation', async () => {
  await pg.exec('DROP TABLE auth.account');
  expect(await migrateHumanAccountSchema(db, options)).toEqual({changed:false});
});
it('refuses duplicate provider/account identities atomically', async () => {
  await legacy(); await pg.exec(`INSERT INTO auth.account VALUES ('collision','provider','identity','https://other.invalid')`);
  const before = await schema();
  await expect(migrateHumanAccountSchema(db, options)).rejects.toThrow('Duplicate authentication');
  expect(await schema()).toEqual(before);
  expect((await pg.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='auth' AND indexname='account_issuer_accountId_uidx'`)).rows).toEqual([{n:1}]);
  expect((await pg.query('SELECT count(*)::int AS n FROM auth.account')).rows).toEqual([{n:2}]);
});
it('refuses an unexpected index definition without making issuer nullable', async () => {
  await legacy(); await pg.exec(`DROP INDEX auth."account_issuer_accountId_uidx"; CREATE INDEX "account_issuer_accountId_uidx" ON auth.account ("accountId",issuer)`);
  const before = await schema();
  await expect(migrateHumanAccountSchema(db, options)).rejects.toThrow('Unexpected legacy authentication index');
  expect(await schema()).toEqual(before);
});
it('refuses unexpected issuer defaults without altering data', async () => {
  await legacy(); await pg.exec(`ALTER TABLE auth.account ALTER COLUMN issuer SET DEFAULT 'unexpected'`);
  await expect(migrateHumanAccountSchema(db, options)).rejects.toThrow('Unexpected authentication issuer column');
  expect((await schema()).rows).toContainEqual({column_name:'issuer',is_nullable:'NO'});
});
it('requires explicit coordinated-operation acknowledgement', async () => {
  await legacy();
  await expect(migrateHumanAccountSchema(db, {writesPausedAndBackupVerified: false} as never)).rejects.toThrow('Stop all auth/account writers');
});
it('fresh runtime works and existing-user startup refuses legacy schema without DDL', async () => {
  await pg.exec('DROP TABLE auth.account');
  const opts = {pglite:pg, secret:'migration-test-secret'.padEnd(32,'0'),baseURL:'http://localhost:4794',mail:{send:async () => {}}};
  await createHumanAuth(opts);
  await pg.exec(`ALTER TABLE auth.account ADD COLUMN issuer text NOT NULL; CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON auth.account (issuer,"accountId")`);
  const before = await schema();
  await expect(createHumanAuth(opts)).rejects.toThrow('Startup never applies this migration');
  expect(await schema()).toEqual(before);
  await migrateHumanAccountSchema(db, options);
  await expect(createHumanAuth(opts)).resolves.toBeDefined();
});

it('refuses a legacy-named index on another table atomically', async () => {
  await legacy(); await pg.exec(`DROP INDEX auth."account_issuer_accountId_uidx"; CREATE TABLE auth.other (issuer text, "accountId" text); CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON auth.other (issuer,"accountId")`);
  const before = await schema();
  await expect(migrateHumanAccountSchema(db, options)).rejects.toThrow('Unexpected legacy authentication index');
  expect(await schema()).toEqual(before);
});

it.each([false, true])('startup refuses duplicate identities with nullable issuer present=%s without mutations', async hasIssuer => {
  if (hasIssuer) await pg.exec('ALTER TABLE auth.account ADD COLUMN issuer text');
  await pg.exec(`INSERT INTO auth.account (id,"providerId","accountId") VALUES ('one','provider','same'),('two','provider','same')`);
  const before = await schema();
  const rows = await pg.query('SELECT * FROM auth.account ORDER BY id');
  await expect(assertHumanAccountSchema(db)).rejects.toThrow('Duplicate authentication provider/account identities');
  expect(await schema()).toEqual(before);
  expect(await pg.query('SELECT * FROM auth.account ORDER BY id')).toEqual(rows);
});
