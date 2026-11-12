/**
 * WHERE THIS PROCESS STANDS WITH THE IDENTITY MODULE'S SCHEMA, at its database's open (./db):
 *  - it writes `identity_settings`, the app's row the read views' rules read (the deployment mode, the API audiences an
 *    OAuth token may be bound to and the configured services' origins), from its own settings, on every boot in every
 *    mode;
 *  - when identity runs in this process (no `AUTH__SERVICE_URL`: ./services) it is identity's host, so it ensures the
 *    identity schema itself (@artifactbin/auth `ensureIdentitySchema`: base tables in AUTH__SCHEMA, the read views in
 *    IDENTITY__SCHEMA);
 *  - either way it then insists that `users` on its own connection IS the read view, so a database whose base tables
 *    were never moved out of the app's schema fails at boot, named, instead of serving stale rows. With an auth host,
 *    whose boot creates the views after this one's tables, it waits for them (bounded), then refuses.
 * A test that changes the mode with `overrideConfig` calls `syncIdentitySettings` again: the row does not follow
 * config on its own.
 */
import {API_RESOURCE_PATH,type Queryable,type TransactionalQueryable} from '@artifactbin/contracts';
import {assertGroupRoleModel} from '@artifactbin/auth/identity-store/group-role-migration';
import {ensureIdentitySchema} from '@artifactbin/auth/identity-store';
import {ALIAS_ORIGINS,AUTH_SCHEMA,AUTH_SERVICE_URL,IDENTITY_READ_SCHEMA,PUBLIC_BASE_URL,deploymentConfig,serviceAudiences} from './config';

/** This process's settings into the row the identity views read. */
export async function syncIdentitySettings(db: Queryable): Promise<void> {
  const origins = [...new Set([new URL(PUBLIC_BASE_URL).origin, ...ALIAS_ORIGINS])];
  await db.query(`INSERT INTO identity_settings(id,deployment_mode,api_audiences,service_audiences) VALUES('installation',$1,$2,$3)
    ON CONFLICT (id) DO UPDATE SET deployment_mode=excluded.deployment_mode,api_audiences=excluded.api_audiences,service_audiences=excluded.service_audiences`,
    [deploymentConfig().mode, origins.map(origin => `${origin}${API_RESOURCE_PATH}`), serviceAudiences().map(service => service.origin)]);
}

/** The identity schema, when this process hosts identity (again once Better Auth's tables exist: the sessions view). */
export async function ensureLocalIdentity(db: TransactionalQueryable): Promise<void> {
  if (AUTH_SERVICE_URL) return;
  const app = (await db.query<{schema: string}>('SELECT current_schema() AS schema')).rows[0]!.schema;
  await ensureIdentitySchema(db, {auth: AUTH_SCHEMA, app, read: IDENTITY_READ_SCHEMA});
}

const readsView = async (db: Queryable): Promise<{ok: boolean; found: string}> => {
  const row = (await db.query<{relkind: string; schema: string}>(
    "SELECT c.relkind, n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('users')")).rows[0];
  return {ok: row?.relkind === 'v' && row.schema === IDENTITY_READ_SCHEMA, found: row ? `${row.schema}.users (${row.relkind === 'v' ? 'a view' : 'a table'})` : 'nothing'};
};

/** Boot: settings, identity (when local), then `users` must resolve to the read view on this connection. */
export async function openIdentity(db: TransactionalQueryable, waitMs = 120_000): Promise<void> {
  await syncIdentitySettings(db);
  await ensureLocalIdentity(db);
  const deadline = Date.now() + (AUTH_SERVICE_URL ? waitMs : 0);
  for (let logged = false; ; ) {
    const seen = await readsView(db);
    if (seen.ok) { await assertGroupRoleModel(db, IDENTITY_READ_SCHEMA); return; }
    if (Date.now() >= deadline) throw new Error(`identity: \`users\` resolves to ${seen.found}, not the read view ${IDENTITY_READ_SCHEMA}.users. `
      + (AUTH_SERVICE_URL ? 'Boot the auth host (it creates the identity schema once this app\'s tables exist), and move any identity table still in the app\'s schema into AUTH__SCHEMA (@artifactbin/auth identityMoveStatements).'
        : 'The identity tables could not be moved into AUTH__SCHEMA on this database; see the error above.'));
    if (!logged) { console.warn(`[identity] waiting for the auth host to create ${IDENTITY_READ_SCHEMA} (up to ${Math.round(waitMs / 1000)} s)`); logged = true; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
