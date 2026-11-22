/**
 * THE IDENTITY MODULE'S TABLES (contracts `IDENTITY_OWNED_TABLES`), declared here and created by the identity host's
 * boot (`ensureIdentitySchema`) in the identity module's own schema, AUTH__SCHEMA. Nobody else reads them: every
 * reader (the app, and any service granted them) reads the thin views of the same names in the identity read schema (./views), which
 * expose each table as it is minus `SECRET_COLUMNS`.
 *
 * Additive, like every declaration in this product (utils renderSchema): a new column is nullable or has a default.
 */
import type { Table } from '@artifactbin/contracts/schema';

const ACCOUNT_PREFERENCES:Table={name:'account_preferences',columns:[
 {name:'user_id',type:'TEXT',notNull:true},{name:'default_destination',type:'JSONB',notNull:true,default:"'{\"type\":\"inherit\"}'::jsonb"},
],primaryKey:['user_id']};

const USERS: Table = {
  name: 'users',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true }, // 'usr_' + base36
    { name: 'email', type: 'TEXT', relaxNotNull: true },
    /*
     * THE KIND. One column answers what a user IS, and every permission
     * decision reads it through `lib/capabilities` rather than re-deriving it:
     *   'account'  — a signed-in person;
     *   'guest'    — an anonymous browser that saved something, claimable at login;
     *   'testuser' — a throwaway second person an account minted (parent_user_id),
     *                erased with everything it owns.
     * The default is 'account' so the additive ALTER is legal on a non-empty
     * table.
     */
    { name: 'kind', type: 'TEXT', notNull: true, default: "'account'" },
    /** The ACCOUNT that minted a test user; NULL for everyone else. */
    { name: 'parent_user_id', type: 'TEXT' },
    /** A test user's death date; NULL for an account or a guest, which do not expire. */
    { name: 'expires_at', type: 'TIMESTAMPTZ' },
    // Verified guest adoption preserves the identity pinned by existing CLI workspaces.
    { name: 'merged_into_user_id', type: 'TEXT' },
    // Last group vouched for by a verified sign-in, for upgrading historical seats.
    { name: 'trusted_sign_in_group', type: 'TEXT' },
    { name: 'trusted_sign_in_at', type: 'TIMESTAMPTZ' },
    { name: 'trusted_root_granted', type: 'TEXT' },
    { name: 'name', type: 'TEXT' },
    // Public handle for pretty URLs (/@username/...). Lowercase [a-z0-9_],
    // auto-assigned at login (localpart_xxxx), renameable. Nullable so the
    // additive ALTER is legal on non-empty tables; backfilled lazily at login.
    { name: 'username', type: 'TEXT' },
    // The profile picture: an object-store key (`avatar/<sha256>`), one square
    // WebP written by lib/avatars. NULL = no picture; the client draws a
    // generated initial. Public by id, like the handle.
    { name: 'image_key', type: 'TEXT' },
    // TRUE from the moment the app first creates a row for a NEW person
    // (lib/profiles) until they confirm the welcome page. Existing rows take the
    // default and never see it; no backfill needed, which is why this is a flag
    // set at insert rather than a timestamp that would have to be back-dated.
    { name: 'auto_accept_mentions', type: 'BOOLEAN', notNull: true, default: 'true' },
    { name: 'welcome_pending', type: 'BOOLEAN', notNull: true, default: 'false' },
    // TRUE for an account whose row was CREATED for an address at the test domain while test-domain
    // sign-in was on (lib/accounts/test-accounts). Set at insert only, like welcome_pending: existing
    // rows take the default and are never marked, so a later cleanup can select exactly these.
    { name: 'test_account', type: 'BOOLEAN', notNull: true, default: 'false' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    // Assigned by the identity operator. NULL preserves existing account behavior.
    { name: 'tenancy_id', type: 'TEXT' },
    // Root removal suspends company admission while retaining its historical record.
    { name: 'deployment_admission_revoked', type: 'BOOLEAN', notNull: true, default: 'false' },
    { name: 'interactive_authority_id', type: 'UUID', notNull: true, default: 'gen_random_uuid()' },
  ],
  primaryKey: ['id'],
  // Both unique constraints use the `indexes` form ON PURPOSE: entries in
  // `uniques` only render inside CREATE TABLE, so they never reach a
  // database that already exists — an index applies retroactively.
  indexes: [
    { name: 'idx_users_email', columns: ['email'], unique: true },
    { name: 'idx_users_username', columns: ['username'], unique: true },
    // "How many live test users does this account hold?" and "erase them all"
    // are both this index; the cap is read on every mint.
    { name: 'idx_users_parent', columns: ['parent_user_id'] },
  ],
  // `is_guest` (replaced by `kind`, which says more: a test user is not a guest) and
  // `password_hash` (login is email + OTP; there are no passwords). Dead data, dropped on boot.
  dropped: ['is_guest', 'password_hash'],
};

const TOKENS: Table = {
  name: 'tokens',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true }, // 'tok_' + base36 — non-secret handle
    { name: 'name', type: 'TEXT' }, // human label ("vivek-laptop")
    { name: 'token_hash', type: 'TEXT', notNull: true }, // sha256 hex of plaintext; the ONLY thing stored
    { name: 'user_id', type: 'TEXT' }, // NULL = anonymous (claimable via /api/tokens/claim)
    // The harness last declared on the agent header, for display attribution on
    // later stateless calls. Self-reported telemetry only — never authorization.
    { name: 'client_harness', type: 'TEXT' },
    // The exact resource an OAuth-issued access token is restricted to.
    // NULL keeps manually minted tokens general-purpose.
    { name: 'audience', type: 'TEXT' },
    { name: 'scope', type: 'TEXT' },
    { name: 'request_authority', type: 'BOOLEAN', notNull: true, default: 'false' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    // NULL = live. The verb stays REVOKE everywhere a person or a function
    // reads it (revokeToken, tokenStatus 'revoked', the dashboard's copy); the
    // COLUMN is `deleted_at` because every table that can lose a row spells it
    // the same way, and one pattern with no exception is worth more than a
    // column name that reads slightly better on this one table. Declared as a
    // rename, so a database built from the old declaration copies the stamps
    // across on its next boot rather than un-revoking every revoked token.
    { name: 'deleted_at', type: 'TIMESTAMPTZ', renamedFrom: 'revoked_at' },
    // Nullable so the additive boot DDL is the migration: existing tokens are
    // grandfathered as non-expiring, and new mints set their own policy.
    { name: 'expires_at', type: 'TIMESTAMPTZ' },
    // Nullable so the same additive migration preserves "never used".
    { name: 'last_used_at', type: 'TIMESTAMPTZ' },
    // THE PRINCIPAL. NULL on a person's token: its principal is its person (`user_id`). A GROUP's sign-in (contracts
    // identity-service `GROUP_SIGN_IN_RULE`, ./accounts `mintGroupSignIn`) sets `group_id` and its level `group_role`
    // ('member' or 'editor') to make the group itself the principal, with `user_id` NULL and `issued_by` the person
    // who authorised it; `grant_id` is for the approval a later kind is issued under (none is written yet). A person's
    // RUN SIGN-IN (contracts `RUN_SIGN_IN_PATH`) sets only `issued_by`: the id of the configured service it was
    // issued to, which the `live` rule reads (its parent credential decides it).
    { name: 'group_id', type: 'TEXT' },
    { name: 'group_role', type: 'TEXT' },
    { name: 'issued_by', type: 'TEXT' },
    { name: 'grant_id', type: 'TEXT' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_tokens_hash', columns: ['token_hash'], unique: true },
    // An account's live tokens (lib/accounts/tokens: the web token, the token list).
    { name: 'idx_tokens_user', columns: ['user_id'], where: 'deleted_at IS NULL' },
    // The identity view also attributes personally authorised group tokens to the issuing account.
    { name: 'idx_tokens_live_account', columns: ['(CASE WHEN group_id IS NOT NULL AND grant_id IS NULL THEN issued_by ELSE user_id END)'], where: 'deleted_at IS NULL' },
    // A group's sign-ins: by group (its Admins' list) and by the person who authorised them (their token list).
    { name: 'idx_tokens_group', columns: ['group_id'], where: 'group_id IS NOT NULL' },
    { name: 'idx_tokens_group_issuer', columns: ['issued_by'], where: 'group_id IS NOT NULL' },
  ],
};

const HANDLE_RESERVATIONS:Table={name:'handle_reservations',columns:[
 {name:'handle',type:'TEXT',notNull:true},{name:'kind',type:'TEXT',notNull:true},{name:'subject_id',type:'TEXT',notNull:true},
],primaryKey:['handle'],indexes:[{name:'idx_handle_reservations_subject',columns:['kind','subject_id'],unique:true}]};

/** Groups: independent owners of pages, in one handle namespace with accounts. */
const GROUPS:Table={name:'groups',columns:[
 {name:'id',type:'TEXT',notNull:true},{name:'handle',type:'TEXT',notNull:true},
 {name:'name',type:'TEXT',notNull:true},{name:'description',type:'TEXT',notNull:true,default:"''"},
 {name:'created_by',type:'TEXT',notNull:true},{name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},
 {name:'deleted_at',type:'TIMESTAMPTZ'},
 // THE TREE (lib/groups hierarchy): one parent at most, in this installation (this database), never a cycle.
 // NULL is a root. Written only by the topology changes, under the hierarchy revision's row.
 {name:'parent_id',type:'TEXT'},
 {name:'parent_edge_id',type:'UUID',notNull:true,default:'gen_random_uuid()'},
 // A group a trusted issuer's sign-in created (./trusted-sign-in): that issuer, and the tenancy it named, both set at
 // creation and never changed. NULL for every other group.
 {name:'trusted_issuer',type:'TEXT'},{name:'tenancy_id',type:'TEXT'},
],primaryKey:['id'],indexes:[{name:'idx_groups_handle',columns:['handle'],unique:true},{name:'idx_groups_parent',columns:['parent_id'],where:'parent_id IS NOT NULL'}]};

/**
 * THE HIERARCHY REVISION: one row, id 'installation', seeded by `ensureIdentityRows`. Every topology change (group
 * create, delete, reparent) bumps `revision` as its first statement, which also serializes topology changes; a reader
 * that caches anything per tree (a service's stale-policy rule) reads it. Nothing else locks it.
 */
const GROUP_HIERARCHY:Table={name:'group_hierarchy',columns:[
 {name:'id',type:'TEXT',notNull:true},{name:'revision',type:'BIGINT',notNull:true,default:'0'},
 // Version 1 is the legacy Editor/Viewer model. Only the explicit migration upgrades existing grants.
 {name:'role_model_version',type:'INTEGER',notNull:true,default:'1'},
],primaryKey:['id']};

const GROUP_MEMBERS:Table={name:'group_members',columns:[
 {name:'group_id',type:'TEXT',notNull:true},{name:'user_id',type:'TEXT',notNull:true},
 {name:'role',type:'TEXT',notNull:true},{name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},
 {name:'seat_id',type:'UUID',notNull:true,default:'gen_random_uuid()'},
 {name:'admin_tenure_id',type:'UUID',notNull:true,default:'gen_random_uuid()'},
],primaryKey:['group_id','user_id'],indexes:[{name:'idx_group_members_user',columns:['user_id']}]};

const GROUP_INVITATIONS:Table={name:'group_invitations',columns:[
 {name:'id',type:'TEXT',notNull:true},{name:'group_id',type:'TEXT',notNull:true},{name:'email',type:'TEXT',notNull:true},
 {name:'role',type:'TEXT',notNull:true},{name:'invited_by',type:'TEXT',notNull:true},
 {name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},
],primaryKey:['id'],indexes:[
 {name:'idx_group_invitations_email',columns:['group_id','email'],unique:true},
 // acceptGroupInvitations asks by the verified address alone, which the unique (group_id, email) cannot lead.
 {name:'idx_group_invitations_by_email',columns:['email']},
]};

const GROUP_MAIL_OUTBOX:Table={name:'group_mail_outbox',columns:[
 {name:'id',type:'TEXT',notNull:true},{name:'email',type:'TEXT',notNull:true},{name:'recipient_id',type:'TEXT'},
 {name:'group_id',type:'TEXT',notNull:true},{name:'group_name',type:'TEXT',notNull:true},{name:'handle',type:'TEXT',notNull:true},
 {name:'action',type:'TEXT',notNull:true},{name:'sender_id',type:'TEXT',notNull:true},
 {name:'lease_until',type:'TIMESTAMPTZ'},{name:'claim_token',type:'TEXT'},
 {name:'attempts',type:'INTEGER',notNull:true,default:'0'},{name:'next_attempt_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},
 {name:'quarantined_at',type:'TIMESTAMPTZ'},{name:'sent_at',type:'TIMESTAMPTZ'},{name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},
],primaryKey:['id'],indexes:[{name:'idx_group_mail_pending',columns:['created_at'],where:'sent_at IS NULL'}]};

/**
 * A GROUP'S APPROVAL OF A SERVICE (contracts service-audiences `GROUP_SIGN_IN_PATH`): an Admin of the group (direct, or
 * through an ancestor) let the configured service `service_id` sign an agent in as the group at `role` (`member` or
 * `editor`) with nobody present. Written only through the identity module (./groups `approveServiceGroupSignIn`);
 * `approved_by` is history, never authority: the approval belongs to the group and lives until an Admin revokes it
 * (`deleted_at`) or the group is deleted, and every sign-in issued under it ends with it (`tokens.grant_id`).
 * `service_origin` is the service's configured origin when it was approved: the approval is that service's only while
 * the id is still configured, with the opt-in, at that origin, so a different service given the old id later inherits
 * nothing (NULL matches no configuration). Appended, nullable: replay-safe on a live database.
 */
const GROUP_SIGN_IN_GRANTS:Table={name:'group_sign_in_grants',columns:[
 {name:'id',type:'TEXT',notNull:true},{name:'group_id',type:'TEXT',notNull:true},{name:'role',type:'TEXT',notNull:true},
 {name:'service_id',type:'TEXT',notNull:true},{name:'approved_by',type:'TEXT',notNull:true},
 {name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},{name:'deleted_at',type:'TIMESTAMPTZ'},
 {name:'service_origin',type:'TEXT'},
],primaryKey:['id'],indexes:[{name:'idx_group_sign_in_grants_group',columns:['group_id'],where:'deleted_at IS NULL'}]};

// Immutable sign-in facts. The app reads the view to project them into its audit with its own role.
const HOST_TENANCY_CHANGES: Table = {name:'host_tenancy_changes', columns:[
  {name:'seq',type:'BIGSERIAL',notNull:true}, {name:'group_id',type:'TEXT',notNull:true},
  {name:'issuer',type:'TEXT',notNull:true}, {name:'person_id',type:'TEXT',notNull:true},
  {name:'previous_tenancy_id',type:'TEXT'}, {name:'tenancy_id',type:'TEXT',notNull:true},
  {name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'clock_timestamp()'},
],primaryKey:['seq']};

/** @public Read by scripts/render-schema.mjs, which finds Table data among this module's exports. */
export const IDENTITY_TABLES: Table[] = [USERS, ACCOUNT_PREFERENCES, TOKENS, HANDLE_RESERVATIONS, GROUPS, GROUP_HIERARCHY, GROUP_MEMBERS, GROUP_INVITATIONS, GROUP_MAIL_OUTBOX, GROUP_SIGN_IN_GRANTS, HOST_TENANCY_CHANGES];

/**
 * THE SECRET COLUMNS, the one list: no view exposes them, so only the identity module reads them. A credential's
 * hash (`tokens.token_hash`) and Better Auth's session token (`session.token`, the cookie's value). The other
 * secrets live in tables no view exposes at all (Better Auth's `account` passwords and provider tokens, its
 * `verification` codes; the OAuth `credentials` hashes and payloads and `clients`).
 */
export const SECRET_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  groups: ['parent_edge_id'],
  group_members: ['seat_id', 'admin_tenure_id'],
  users: ['trusted_sign_in_group', 'trusted_sign_in_at', 'trusted_root_granted', 'interactive_authority_id'],
  tokens: ['token_hash'],
  session: ['token'],
};
