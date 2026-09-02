/**
 * Schema as data → idempotent DDL. (Distilled from minusx
 * lib/database/schema/tables.ts + render.ts.)
 *
 * The APP's table declarations — the data only. The renderer (renderSchema,
 * ensureTable) lives in @artifactbin/utils and is shared; `SCHEMA_STATEMENTS`
 * below is derived from this data through it, so there is one renderer and
 * one set of declarations. Each package declares its own tables; the shapes
 * (Column/Index/Table) are the contract's.
 */
import type { Column, Index, Table } from '@artifactbin/contracts';
import { renderSchema } from '@artifactbin/utils';

const USERS: Table = {
  name: 'users',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true }, // 'usr_' + base36
    { name: 'email', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT' },
    // Public handle for pretty URLs (/@username/...). Lowercase [a-z0-9_],
    // auto-assigned at login (localpart_xxxx), renameable. Nullable so the
    // additive ALTER is legal on non-empty tables; backfilled lazily at login.
    { name: 'username', type: 'TEXT' },
    // Retired: login is email + OTP, there are no passwords. Existing rows keep
    // their dead bcrypt hash; nothing reads or writes this.
    { name: 'password_hash', type: 'TEXT', retired: true },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['id'],
  // Both unique constraints use the `indexes` form ON PURPOSE: entries in
  // `uniques` only render inside CREATE TABLE, so they never reach a
  // database that already exists — an index applies retroactively.
  indexes: [
    { name: 'idx_users_email', columns: ['email'], unique: true },
    { name: 'idx_users_username', columns: ['username'], unique: true },
  ],
};

const TOKENS: Table = {
  name: 'tokens',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true }, // 'tok_' + base36 — non-secret handle
    { name: 'name', type: 'TEXT' }, // human label ("vivek-laptop")
    { name: 'token_hash', type: 'TEXT', notNull: true }, // sha256 hex of plaintext; the ONLY thing stored
    { name: 'user_id', type: 'TEXT' }, // NULL = anonymous (claimable via /api/tokens/claim)
    // Last branded MCP initialize for display attribution on later stateless calls.
    // Self-reported telemetry only — never used for authorization.
    { name: 'client_harness', type: 'TEXT' },
    // OAuth-issued MCP access tokens are accepted only at this exact resource.
    // NULL keeps manual and grandfathered tokens general-purpose.
    { name: 'audience', type: 'TEXT' },
    { name: 'scope', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    { name: 'revoked_at', type: 'TIMESTAMPTZ' }, // NULL = live (soft revoke)
    // Nullable so the additive boot DDL is the migration: existing tokens are
    // grandfathered as non-expiring, and new mints set their own policy.
    { name: 'expires_at', type: 'TIMESTAMPTZ' },
    // Nullable so the same additive migration preserves "never used".
    { name: 'last_used_at', type: 'TIMESTAMPTZ' },
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'idx_tokens_hash', columns: ['token_hash'], unique: true }],
};

const ARTIFACTS: Table = {
  name: 'artifacts',
  columns: [
    // The one identifier: 6+ chars of [a-zA-Z0-9] (lib/ids.ts generateFileId).
    // API handle, ref:<id> target, and URL address all at once — an address,
    // not a secret. The PK is what makes collisions retryable (23505).
    { name: 'id', type: 'TEXT', notNull: true },
    { name: 'token_id', type: 'TEXT', notNull: true }, // creating token (provenance + anon scope)
    { name: 'user_id', type: 'TEXT' }, // owner; NULL until the creating token is claimed
    // The read ACL: 'public' = anyone with the link (never LISTED anywhere),
    // 'private' = owner + artifact_shares emails. The column default covers
    // rows that predate the ACL; createArtifact always sets it explicitly
    // (user-owned → private, anonymous → public).
    { name: 'visibility', type: 'TEXT', notNull: true, default: "'public'" },
    // GENERAL ACCESS, the second half of `visibility`: what the LINK grants
    // whoever holds the address — 'viewer' | 'commenter' | 'editor'. Visibility
    // still answers REACH and LISTING ('private' = nobody by link, 'unlisted' =
    // anyone but shown nowhere, 'public' = anyone and listed on the profile);
    // this answers what they may DO once they are in.
    //
    // NULL means "the pre-roles default", which IS 'viewer' — so every row that
    // predates this column is already correct and there is nothing to backfill.
    // A NULL here is a fact about when the row was written, never a missing
    // value. `linkRoleOf` is the only reader.
    { name: 'link_role', type: 'TEXT' },
    // The WRITE ACL, the sibling of `visibility` — datasets only: 'read' (the
    // default, every dataset that predates it) or 'readwrite' (documents the
    // owner publishes may write rows through a <Mutation>; lib/artifacts
    // canWriteDataset). Other formats carry the default and nothing reads it.
    { name: 'access', type: 'TEXT', notNull: true, default: "'read'" },
    // Materialized folder path ('2026/08/12'; '' = root) — pure display
    // metadata. Resolution is always by id, so moving/renaming a folder is
    // one UPDATE and never breaks a link. No folder table: empty folders
    // don't exist.
    { name: 'folder', type: 'TEXT', notNull: true, default: "''" },
    { name: 'title', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'format', type: 'TEXT', notNull: true, default: "'markup'" }, // ArtifactFormat (lib/story/input.ts); no CHECK on purpose
    { name: 'content', type: 'TEXT', notNull: true }, // what /a/<id> serves (rendered, for stories)
    { name: 'source', type: 'TEXT' }, // story markup for round-trip editing; NULL in html mode
    { name: 'meta', type: 'JSONB', notNull: true, default: "'{}'" }, // stories: {theme}
    { name: 'version', type: 'INTEGER', notNull: true, default: '1' },
    // Head pointer of the edit protocol: unguessable, regenerated on every
    // accepted write. The volatile DEFAULT backfills pre-protocol rows on the
    // additive ALTER; app writes always set it explicitly (lib/story/splice
    // newEditId). Possession proves the caller read the version it bases on.
    { name: 'edit_id', type: 'TEXT', notNull: true, default: 'md5(random()::text)' },
    // WHO made the head — the last accepted writer (an account, or the token
    // when anonymous). Distinct from user_id/token_id, which name the OWNER:
    // with editors (artifact_shares.role) the two part ways. Copied onto the
    // version row when this state is archived, so history can say who.
    { name: 'actor_user_id', type: 'TEXT' },
    { name: 'actor_token_id', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    { name: 'updated_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'idx_artifacts_token_updated', columns: ['token_id', 'updated_at DESC'] }],
};

// Append-only; a row is the state BEFORE a PUT replaced it.
const ARTIFACT_VERSIONS: Table = {
  name: 'artifact_versions',
  columns: [
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'version', type: 'INTEGER', notNull: true },
    { name: 'title', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'format', type: 'TEXT', notNull: true, default: "'markup'" },
    { name: 'content', type: 'TEXT', notNull: true },
    { name: 'source', type: 'TEXT' },
    { name: 'meta', type: 'JSONB', notNull: true, default: "'{}'" },
    // Who produced THIS state (artifacts.actor_* at the moment it was archived).
    { name: 'actor_user_id', type: 'TEXT' },
    { name: 'actor_token_id', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['artifact_id', 'version'],
};

// Append-only edit log (concurrent-edits protocol). A row records one accepted
// splice IN THE COORDS OF ITS BASE VERSION (post-sanitize stored text, not the
// caller's literal diff): `removed`/`inserted` make it invertible, so any
// still-logged base version reconstructs in JS; `span_*` is the touched-node
// span the conflict check intersects. Prunable — a pruned base answers
// stale_edit_id, never a wrong apply.
const ARTIFACT_EDITS: Table = {
  name: 'artifact_edits',
  columns: [
    { name: 'seq', type: 'BIGSERIAL', notNull: true },
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'edit_id', type: 'TEXT', notNull: true },
    { name: 'splice_start', type: 'INTEGER', notNull: true },
    { name: 'removed', type: 'TEXT', notNull: true },
    { name: 'inserted', type: 'TEXT', notNull: true },
    { name: 'span_start', type: 'INTEGER', notNull: true },
    { name: 'span_end', type: 'INTEGER', notNull: true },
    // Who made the splice — NULL on rows that predate attribution.
    { name: 'actor_user_id', type: 'TEXT' },
    { name: 'actor_token_id', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['seq'],
  uniques: [['edit_id']],
  indexes: [{ name: 'idx_artifact_edits_artifact_seq', columns: ['artifact_id', 'seq'] }],
};

/**
 * The NAMED people on an artifact and what they may do — the sibling of
 * `visibility` (who may read via the link), applying under every visibility.
 * Keyed by EMAIL, not user id, so an invitation can name an address that has
 * no account yet — it simply starts working at that address's first login
 * (lib/artifacts matches a session by email and a token by its account's
 * email). The PK makes re-adding idempotent.
 *
 * `role`: 'viewer' (may read a private artifact — every row that predates the
 * column) or 'editor' (may also edit, PUT, revert and read history; never
 * delete, share, move or open writes — those stay the owner's).
 */
const ARTIFACT_SHARES: Table = {
  name: 'artifact_shares',
  columns: [
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'email', type: 'TEXT', notNull: true }, // stored lowercase; matched against the session email
    { name: 'role', type: 'TEXT', notNull: true, default: "'viewer'" }, // ShareRole (lib/share-roles); no CHECK, like every other enum column
    { name: 'user_id', type: 'TEXT' }, // RESOLVED on first match (lib/artifacts resolveSharesFor); NULL = an invite nobody has matched yet
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['artifact_id', 'email'],
};

/**
 * Human/agent comments pinned to nodes of a document — ONE self-referencing table where every row is a
 * comment. A ROOT row (root_id NULL) carries the anchor and the open/resolved
 * status; replies point at their root. Deliberately a SIDECAR, never part of
 * the source: a PUT/edit can no more clobber a comment than it can flip
 * `visibility`. The anchor key is stored in the node's own
 * `data-annotation-anchor` attribute, stamped into the SOURCE through the edit protocol
 * when the first comment lands on a node (so concurrent edits, versioning and
 * revert all treat it as the ordinary edit it is). Resolution is a lookup in
 * the CURRENT source: attribute present → anchored, absent → orphaned, and
 * orphaned is re-checked on every read, so a revert that brings the text back
 * re-anchors the thread. No FKs (house rule) — deleteArtifactScoped
 * hand-deletes.
 */
const ANNOTATIONS: Table = {
  name: 'annotations',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true }, // 'ann_' + 96-bit base36
    { name: 'seq', type: 'BIGSERIAL', notNull: true }, // stable thread order (created_at ties)
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'root_id', type: 'TEXT' }, // NULL = annotation root; else the root's id (a reply)
    { name: 'body', type: 'TEXT', notNull: true },
    // Attribution — derived from the credential at the door, never caller-supplied.
    { name: 'author_kind', type: 'TEXT', notNull: true }, // 'human' | 'agent' (legacy rows may say 'owner')
    { name: 'author_token_id', type: 'TEXT' },
    { name: 'author_user_id', type: 'TEXT' },
    { name: 'author_label', type: 'TEXT' }, // display snapshot; survives token revocation
    // Per-comment provenance: a token may use MCP for one reply and raw HTTP for the next.
    { name: 'author_transport', type: 'TEXT', notNull: true, default: "'unknown'" },
    // Root-only columns (NULL on replies):
    { name: 'status', type: 'TEXT', notNull: true, default: "'open'" }, // 'open' | 'resolved'
    { name: 'resolved_at', type: 'TIMESTAMPTZ' },
    { name: 'anchor_key', type: 'TEXT' }, // the node's opaque annotation-anchor key
    { name: 'anchor_version', type: 'INTEGER' }, // document version the comment was made against (display)
    { name: 'snippet', type: 'TEXT', notNull: true, default: "''" }, // plain text, survives orphaning
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'idx_annotations_artifact_seq', columns: ['artifact_id', 'seq'] }],
};

// RETIRED TABLES — `login_codes` and `oauth_codes` merged into `codes` below.
// Boot DDL is additive-only, so databases created before the merge keep the
// (empty — rows lived ≤10 min) old tables; nothing reads or writes them. A
// fresh database never creates them.

/**
 * Fire-and-forget usage events (lib/analytics.ts is the only writer/reader).
 * No FKs on purpose — an event row outlives its artifact, and a failed insert
 * must never take a request down with it. `user_id` is the session viewer or
 * write actor (NULL = anonymous); `client` is the harness guess from
 * lib/client-identity (telemetry only, never gate on it).
 */
const ANALYTICS_EVENTS: Table = {
  name: 'analytics_events',
  columns: [
    { name: 'seq', type: 'BIGSERIAL', notNull: true },
    { name: 'event', type: 'TEXT', notNull: true },
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'user_id', type: 'TEXT' },
    { name: 'client', type: 'TEXT' },
    /** Daily-rotating visitor fingerprint: sha256(day:ip:ua:secret) — never a raw IP. */
    { name: 'visitor', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['seq'],
  indexes: [
    { name: 'idx_analytics_events_artifact_created', columns: ['artifact_id', 'created_at'] },
    { name: 'idx_analytics_events_event', columns: ['event'] },
  ],
};

/**
 * ALL one-time codes, one table (lib/codes.ts is the only writer/reader). A
 * code is a hashed secret that expires and is spent once; the kinds differ only
 * in lookup mode and payload:
 *   login — subject = email, guessable 6-digit → found by subject, attempts-capped
 *   oauth — subject NULL, payload {user_id, redirect_uri, code_challenge} → found by hash
 * Future kinds are a new `kind` string, not a new table.
 *
 * Rows, not a Map, for the same reason oauth_codes learned the hard way: the
 * two legs of a handshake are different route handlers in different bundles
 * (separate instances the moment this scales), and in-memory codes broke OAuth
 * on production for every MCP client at once. Hashed like every credential —
 * a dump must never contain a working code. Near-empty by construction:
 * short TTLs, spent-on-claim, and each issue sweeps its kind's expired rows.
 */
const CODES: Table = {
  name: 'codes',
  columns: [
    { name: 'kind', type: 'TEXT', notNull: true },
    { name: 'code_hash', type: 'TEXT', notNull: true }, // sha256 hex; plaintext never stored
    { name: 'subject', type: 'TEXT' }, // what the code is bound to; NULL = unbound (oauth)
    { name: 'payload', type: 'JSONB', notNull: true, default: "'{}'" }, // handed back on claim
    { name: 'attempts', type: 'INTEGER', notNull: true, default: '0' }, // guess counter; only subject-lookup kinds use it
    { name: 'expires_at', type: 'TIMESTAMPTZ', notNull: true },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['kind', 'code_hash'],
  // The `indexes` form on purpose (see USERS): `uniques` renders only inside
  // CREATE TABLE, so it would never reach an already-created database.
  indexes: [
    // One live code per subject; re-issue supersedes. NULL subjects never
    // collide, so unbound kinds insert freely.
    { name: 'idx_codes_kind_subject', columns: ['kind', 'subject'], unique: true },
    { name: 'idx_codes_expires', columns: ['expires_at'] },
  ],
};

/**
 * Families imported from the web (lib/webfonts), resolved ONCE per deployment.
 * The row is an INDEX, not the bytes: `assets` names the faces and the
 * content-addressed object each was copied into, so a family costs one fetch
 * ever and a reader only ever talks to this origin.
 */
const WEBFONTS: Table = {
  name: 'webfonts',
  columns: [
    { name: 'family', type: 'TEXT', notNull: true },
    { name: 'assets', type: 'JSONB', notNull: true, default: "'[]'" },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['family'],
};

const TABLES: Table[] = [USERS, TOKENS, ARTIFACTS, ARTIFACT_VERSIONS, ARTIFACT_EDITS, ARTIFACT_SHARES, ANNOTATIONS, CODES, ANALYTICS_EVENTS, WEBFONTS];

/** Ordered, individually-executable DDL statements (no splitting needed) — rendered by utils. */
export const SCHEMA_STATEMENTS: string[] = renderSchema(TABLES);
