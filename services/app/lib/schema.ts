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
    // PLACEMENT — the ids of this row's ancestors, root→parent (the
    // materialized-path pattern, with ids rather than names). '{}' is the
    // root, the LAST element is the parent, the array's LENGTH is the level,
    // so nothing is stored twice; lib/folders.ts is the only module that does
    // arithmetic on it. A folder is an artifact (`format: 'folder'`), which is
    // what makes this the whole hierarchy: no second table, no foreign key,
    // and one invariant a test pins — `ancestor_ids = parent.ancestor_ids || parent.id`.
    { name: 'ancestor_ids', type: 'TEXT[]', notNull: true, default: "'{}'" },
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
    // PROVENANCE: the artifact this one was FORKED from — the immediate
    // parent, never a chain, and never updated after creation. NULL means
    // "authored here", which every row written before the column existed
    // already is: that equivalence is the whole migration. No foreign key —
    // deleting the original must not delete the copy, and a fork of a document
    // that is later gone is still honestly a fork.
    { name: 'forked_from', type: 'TEXT' },
    // THE TRASH. NULL = live; a timestamp = deleted, and invisible to every
    // read (lib/trash LIVE_ARTIFACT_SQL, composed into the row-loading seam in
    // lib/artifacts rather than added by callers). Delete SETS it, restore
    // clears it, and the purge hard-deletes what has sat here past the
    // retention. Every row written before the column existed is NULL, which
    // is exactly "live" — that equivalence is the whole migration.
    { name: 'deleted_at', type: 'TIMESTAMPTZ' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_artifacts_token_updated', columns: ['token_id', 'updated_at DESC'] },
    // The three placement reads, one index each. GIN containment answers "every
    // row under this folder" (the subtree, its height, a forced delete);
    // the expression index answers "the children of this folder" off the last
    // element; and (user_id, level) answers an account's ROOT listing, which is
    // the dashboard's own query.
    { name: 'idx_artifacts_ancestors', columns: ['ancestor_ids'], using: 'gin' },
    { name: 'idx_artifacts_parent', columns: ['(ancestor_ids[cardinality(ancestor_ids)])'] },
    { name: 'idx_artifacts_user_level', columns: ['user_id', '(cardinality(ancestor_ids))'] },
  ],
  // `folder` was a materialized PATH of names ('2026/08/reports'). Placement is
  // `ancestor_ids` now — ids, so two sibling folders may share a name and a
  // rename breaks nothing — and the old column is dead data, dropped on boot.
  dropped: ['folder'],
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
    { name: 'changes', type: 'JSONB' },
    // Who made the splice — NULL on rows that predate attribution.
    { name: 'actor_user_id', type: 'TEXT' },
    { name: 'actor_token_id', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['seq'],
  uniques: [['edit_id']],
  indexes: [{ name: 'idx_artifact_edits_artifact_seq', columns: ['artifact_id', 'seq'] }],
};

/** Lifetime identity ledger: source ids are never reused within an artifact. */
const ARTIFACT_SOURCE_IDS: Table = {
  name: 'artifact_source_ids',
  columns: [
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'source_id', type: 'TEXT', notNull: true },
    { name: 'provenance', type: 'TEXT', notNull: true },
    { name: 'first_version', type: 'INTEGER', notNull: true },
    { name: 'retired_version', type: 'INTEGER' },
  ],
  primaryKey: ['artifact_id', 'source_id'],
};

/** Explicit migration map from retired annotation keys to source identity. */
const ARTIFACT_NODE_ALIASES: Table = {
  name: 'artifact_node_aliases',
  columns: [
    { name: 'artifact_id', type: 'TEXT', notNull: true },
    { name: 'legacy_key', type: 'TEXT', notNull: true },
    { name: 'source_id', type: 'TEXT', notNull: true },
    { name: 'source_path', type: 'TEXT', notNull: true },
    { name: 'created_version', type: 'INTEGER', notNull: true },
  ],
  primaryKey: ['artifact_id', 'legacy_key'],
};

const NODE_IDENTITY_MIGRATION_JOBS: Table = {
  name: 'node_identity_migration_jobs',
  columns: [
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'version', type: 'INTEGER', notNull: true },
    { name: 'cursor', type: 'TEXT' },
    { name: 'completed_at', type: 'TIMESTAMPTZ' },
    { name: 'updated_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['name'],
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
 * re-anchors the thread. No FKs (house rule) — the purge (lib/trash)
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
    // THE EXACT SELECTION, beside the one durable anchor — a hint, never an
    // identity. Both stored verbatim on create and NEVER recomputed (the
    // snippet above is the node's CURRENT text; these are what was selected
    // then). APPENDED LAST, like every additive column: existing databases
    // grow them by ADD COLUMN IF NOT EXISTS on the next boot.
    { name: 'quote', type: 'TEXT' }, // canonical selected text, capped (lib/story/annotation-range)
    { name: 'range', type: 'TEXT' }, // JSON AnnotationRange: parts addressed RELATIVE to the anchor
    // The same soft-delete stamp `artifacts` carries, and the same gate: a row
    // with it set is nonexistent to every reader in lib/annotations. Deleting a
    // comment is still a HARD delete (deleteAnnotationFor) — erasing someone's
    // words is a deliberate act with no restore door behind it — so nothing
    // writes this today; it is the column the pattern owes every adopted table,
    // and the gate that makes adopting it later a one-line change.
    { name: 'deleted_at', type: 'TIMESTAMPTZ' },
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

/**
 * THE GLOBAL URL → OBJECT CACHE for URL-kept external assets (lib/web-assets).
 *
 * Keyed by sha256 of the CANONICAL url (lib/story/asset-url), so the same URL
 * is ONE object for everyone and the first importer pays the fetch — a second
 * document naming it stores nothing. The row is the INDEX (the db is the only
 * index); the bytes live in the object store under `object_key`.
 *
 * `width`/`height`/`placeholder` are what stops URL-keeping from costing the
 * reader a jumping page: they are the box the served `<img>` reserves and the
 * blur it shows while the bytes travel — exactly what an uploaded `ref:` image
 * has carried since the store began measuring them. `fetched_by_user_id` rides
 * beside the token because the BYTE quota is account-keyed for a claimed token
 * (all of one person's tokens share one cap) and token-keyed for an anonymous
 * one, which has no account to key on.
 */
const WEB_ASSETS: Table = {
  name: 'web_assets',
  columns: [
    { name: 'url_hash', type: 'TEXT', notNull: true },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'object_key', type: 'TEXT', notNull: true },
    { name: 'content_type', type: 'TEXT', notNull: true },
    { name: 'bytes', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'width', type: 'INTEGER' },
    { name: 'height', type: 'INTEGER' },
    { name: 'placeholder', type: 'TEXT' },
    // The narrow copy stored beside the full one (lib/images/optimise): its
    // key and the width it was made at, which is the `srcset` descriptor. Null
    // for a font, for an image that was never wide enough to need one, and for
    // every row stored before the variant existed — all of which simply offer
    // one width, exactly as they did.
    { name: 'small_object_key', type: 'TEXT' },
    { name: 'small_width', type: 'INTEGER' },
    { name: 'fetched_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    { name: 'fetched_by_token_id', type: 'TEXT' },
    { name: 'fetched_by_user_id', type: 'TEXT' },
  ],
  primaryKey: ['url_hash'],
  indexes: [
    { name: 'idx_web_assets_token', columns: ['fetched_by_token_id'] },
    { name: 'idx_web_assets_user', columns: ['fetched_by_user_id'] },
  ],
};

/**
 * STATE, as a sentence: the same subject/verb/object shape as the events log,
 * in the present tense — one row per pair, EVER: a reversal sets `deleted_at`
 * and the next link clears it on the same row, so the composite key is the
 * pair itself. The verb vocabulary is closed (contracts RELATION_VERBS), and
 * every read carries the verb literal so the partial indexes below apply
 * (measured: a Bitmap Index Scan with it, a Seq Scan without). No FKs, as
 * everywhere here; lib/relations.ts is the only writer and reader.
 */
const RELATIONS: Table = {
  name: 'relations',
  columns: [
    { name: 'subject_kind', type: 'TEXT', notNull: true }, // 'user'
    { name: 'subject_id', type: 'TEXT', notNull: true },
    { name: 'verb', type: 'TEXT', notNull: true }, // 'like' | 'follow'
    { name: 'object_kind', type: 'TEXT', notNull: true }, // 'artifact' | 'user'
    { name: 'object_id', type: 'TEXT', notNull: true },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    /** NULL = live; set = undone (unlike, unfollow). The one generic reversal, for every verb. */
    { name: 'deleted_at', type: 'TIMESTAMPTZ' },
  ],
  primaryKey: ['subject_kind', 'subject_id', 'verb', 'object_kind', 'object_id'],
  indexes: [
    /** likes on an artifact */
    { name: 'idx_relations_like_object', columns: ['object_id'], where: "verb = 'like' AND deleted_at IS NULL" },
    /** who I follow */
    { name: 'idx_relations_follow_subject', columns: ['subject_id'], where: "verb = 'follow' AND deleted_at IS NULL" },
    /** who follows me */
    { name: 'idx_relations_follow_object', columns: ['object_id'], where: "verb = 'follow' AND deleted_at IS NULL" },
  ],
};

const DATASET_SECRETS: Table = {
  name: 'dataset_secrets',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true },
    { name: 'token_id', type: 'TEXT', notNull: true },
    { name: 'user_id', type: 'TEXT' },
    { name: 'dataset_id', type: 'TEXT' },
    { name: 'target_hash', type: 'TEXT', notNull: true },
    { name: 'ciphertext', type: 'TEXT', notNull: true },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['id'],
  indexes: [{ name: 'idx_dataset_secrets_dataset', columns: ['dataset_id'] }],
};

/**
 * The app's tables, in the order boot applies them — and the shape
 * scripts/render-schema.mjs prefers, so `SCHEMA.sql` is rendered by the SAME
 * renderer with the deployment's schema qualifier rather than by re-writing
 * unqualified text. A statement the renderer emits that a regex cannot
 * re-qualify (a rename's DO block names its own schema twice) is exactly what
 * that indirection could not survive.
 */
export const TABLES: Table[] = [USERS, TOKENS, ARTIFACTS, ARTIFACT_VERSIONS, ARTIFACT_EDITS, ARTIFACT_SOURCE_IDS, ARTIFACT_NODE_ALIASES, NODE_IDENTITY_MIGRATION_JOBS, ARTIFACT_SHARES, ANNOTATIONS, CODES, ANALYTICS_EVENTS, RELATIONS, WEBFONTS, WEB_ASSETS, DATASET_SECRETS];

/** Ordered, individually-executable DDL statements (no splitting needed) — rendered by utils. */
export const SCHEMA_STATEMENTS: string[] = renderSchema(TABLES);
