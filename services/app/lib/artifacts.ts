/**
 * All artifact SQL. Every read/write is scoped by ownership — an id the caller
 * cannot reach is indistinguishable from a nonexistent one (callers answer a
 * uniform 404). Bearer callers act through a TokenActor: a token claimed by an
 * account works ACCOUNT-WIDE (user_id scope), an anonymous token reaches only
 * what it created (token_id scope).
 */
import { cache } from 'react';
import { trackEvent } from './analytics';
import { sourceWithoutAnchors } from './annotation-anchors';
import { ALLOW_PUBLIC_VISIBILITY, ARTIFACT_QUOTA_PER_TOKEN } from './config';
import { assetByteQuotaExceeded } from './asset-quota';
import { getDb, type Queryable } from './db';
import { generateFileId } from './ids';
import { parseContentInput, type ArtifactFormat } from './story/input';
import { canonicalizeMarkup, publishJsx } from './story/jsx-tier';
import { imageRawUrl, imageVariantUrl, pdfRawUrl } from './story/ref-data';
import { displayTitle } from './story/title';
import { assetWarningFor, importWebAsset, WebAssetRefused, type AssetWarning, type WebAssetKind } from './web-assets';
import { resolveWebFont, UnknownFontError } from './webfonts';
import { webIngestRateLimited } from './auth';
import { json } from './http';
import { loadDatasetRows } from './story/dataset-store';
import {
  applySplice, deriveSpliceByDiff, deriveSpliceFromStrings, newEditId, reconstructBaseSource,
  normalizeSplice, shiftThroughEdits, touchedSpanFor, type EditRecord, type Splice,
} from './story/splice';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { datasetRefsInDataflow, initialValues, isEmptyDataflow, mutationTargets, type Dataflow, type Scalar } from '@/lib/story/dataflow';
import { isMutationRefused, mutateDataset } from '@/lib/story/dataset-mutate';
import { runDataflow, type DatasetTables } from '@/lib/sql/run-dataflow';
import type { RanDataflow, StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { RefLoader, ResolvedRef } from '@/lib/story/refs';
import type { DatasetColumn } from '@/lib/story/data-tiers';
import { checkDocumentData } from '@/lib/story/data-checks';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { ANONYMOUS_CEILING, canRead, capRole, maxRole, shareRolesAtLeast, type ArtifactRole, type ShareEntry, type ShareRole } from './share-roles';

/**
 * The read ACL. 'public' = anyone with the link may read, and owned docs list
 * on the owner's profile root (/@handle — folder pages stay owner-only);
 * 'unlisted' = reads exactly like public but never lists anywhere (the
 * pre-profile meaning of public, kept nameable); 'private' = the owner plus
 * the emails in artifact_shares. Defaults at create: user-owned → 'private',
 * anonymous → 'public' (no owner to anchor an ACL).
 */
export type Visibility = 'public' | 'private' | 'unlisted';

/**
 * The WRITE ACL, on DATASETS only — the sibling of `visibility`, and the
 * whole toggle behind writable data:
 *   'read'      — the default and every dataset that predates this. Documents
 *                 may only SELECT from it; a `<Mutation>` naming it is refused
 *                 at publish, and at every call besides.
 *   'readwrite' — documents the dataset's OWNER publishes may insert, update
 *                 and delete rows through a declared `<Mutation>`, for
 *                 everyone who can read those documents.
 * Two separate questions, deliberately: `visibility` is who may READ the
 * artifact itself, this is who may CHANGE it through a document. Neither
 * implies the other — a public dataset stays read-only unless its owner says
 * otherwise, and an unlisted one can be the writable table behind a poll.
 */
export type DatasetAccess = 'read' | 'readwrite';
export const DATASET_ACCESS: readonly DatasetAccess[] = ['read', 'readwrite'];

// The share vocabulary lives in a PURE module (lib/share-roles) so the share
// menu can import it without the database; re-exported here as the one
// artifact contract every server caller already imports.
export { SHARE_ROLES, type ArtifactRole, type ShareEntry, type ShareRole } from './share-roles';

export interface ArtifactRow {
  id: string;
  token_id: string;
  /** Owner account; NULL until the creating token is claimed. */
  user_id: string | null;
  title: string | null;
  description: string | null;
  format: ArtifactFormat;
  content: string;
  source: string | null;
  meta: Record<string, unknown>;
  version: number;
  visibility: Visibility;
  /** The write ACL — datasets only; every other format carries the 'read' default and nothing reads it. */
  access: DatasetAccess;
  /**
   * GENERAL ACCESS: what the LINK grants whoever holds the address. NULL on
   * every row written before the column existed, and NULL means `viewer` —
   * exactly what those rows already granted, which is why nothing needed
   * backfilling. Read it through `linkRoleOf`, never directly.
   */
  link_role: ShareRole | null;
  /** Materialized folder path ('' = root) — display metadata, never identity. */
  folder: string;
  /** Head pointer of the edit protocol — unguessable, regenerated on every accepted write. */
  edit_id: string;
  /** Who made the head: the last accepted writer (an editor may differ from the owner). */
  actor_user_id: string | null;
  actor_token_id: string | null;
  created_at: string;
  updated_at: string;
  /**
   * PROVENANCE: the artifact this one was FORKED from — the immediate parent,
   * never a chain. NULL is "authored here", which is every row that predates
   * forking. Written once at creation and never updated: a fork's own life
   * (versions, comments, shares) is its own from the first save.
   */
  forked_from: string | null;
}

/** Who is looking, as far as the serving paths know. Null = no session. */
export type Viewer = { userId: string; email: string | null } | null;

/**
 * The ONE read-access decision, made by every public serving path before any
 * bytes leave. Fail closed: an unresolvable session is just a null viewer.
 */
export async function canReadArtifact(
  row: Pick<ArtifactRow, 'id' | 'visibility' | 'user_id' | 'link_role'>,
  viewer: Viewer,
): Promise<boolean> {
  // One decision, asked one way: reading is simply the bottom of the lattice.
  // A Viewer carries no token id, so bare-token ownership is not consulted
  // here — the same as before, and sound because `private` requires an account
  // to anchor its ACL (getSharingFor's canPrivate), so a token-owned document
  // is never private.
  return canRead(await effectiveRole({ ...row, token_id: '' }, { userId: viewer?.userId ?? null, tokenId: null, email: viewer?.email ?? null }));
}

/** Any credential the serving paths resolve, as the ids and address effectiveRole needs. */
export interface RoleActor {
  userId: string | null;
  tokenId: string | null;
  /**
   * The address the session carries, when it carries one. Only ever consulted
   * for a share that is still UNRESOLVED — the moment one matches it is stamped
   * with the user id and matched by that forever after. Email is an attribute,
   * never an identity key.
   */
  email?: string | null;
}

/** Does this actor OWN the row — pure, the account by user_id, a bare token by token_id. */
export function ownsArtifact(row: Pick<ArtifactRow, 'user_id' | 'token_id'>, actor: RoleActor): boolean {
  if (actor.userId && row.user_id) return row.user_id === actor.userId;
  return !!actor.tokenId && row.token_id === actor.tokenId;
}

/**
 * THE ONE ACCESS DECISION — what this actor may do with this row, as a single
 * value on the lattice (lib/share-roles). Read-access is `canRead` of it, the
 * page chrome is `canEdit`/`canAnnotate` of it, and the reader/owner serving
 * split is a comparison against it.
 *
 * It is the MAX of the three independent ways a role can arrive:
 *   - ownership       — the account, or the bare token that created it;
 *   - a named share   — artifact_shares, by resolved user id or unresolved email;
 *   - the LINK        — what a stranger holding the address gets.
 *
 * Replacing `canReadArtifact` + `roleFor`, which asked the same question twice
 * and disagreed: one matched every share role and the session's address, the
 * other matched only editor/commenter and only through users.email. The union
 * of the two is what this implements, which is why the swap is behaviour-
 * preserving — the disagreements were all between values of EQUAL rank.
 */
export async function effectiveRole(
  row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id' | 'visibility' | 'link_role'>,
  actor: RoleActor,
): Promise<ArtifactRole> {
  // Ownership short-circuits: nothing outranks it, so the share lookup is a
  // query the owner's every request would otherwise pay for.
  if (ownsArtifact(row, actor)) return 'owner';
  // THE ANONYMOUS CEILING applies to the LINK only, never to a named share:
  // being invited by address is itself an account-shaped act, while holding a
  // URL is not. Without an account there is nothing to attribute a write to.
  const byLink = actor.userId ? linkRoleOf(row) : capRole(linkRoleOf(row), ANONYMOUS_CEILING);
  return maxRole(byLink, await namedRoleFor(row, actor));
}

/**
 * What the LINK alone grants — everyone who holds the address and nothing else.
 *
 * TWO independent facts, and `visibility` gates the column above it: visibility
 * answers REACH (may the address get you in at all), `link_role` answers what
 * you may DO once it has. So a `private` document grants nothing no matter what
 * the column holds — which is what lets the setting be REMEMBERED across a trip
 * through `private` rather than silently reset.
 *
 * NULL is the pre-column shape and reads as `viewer`, exactly what those rows
 * already granted. That equivalence is the whole migration.
 */
export function linkRoleOf(row: Pick<ArtifactRow, 'visibility' | 'link_role'>): ArtifactRole {
  if (row.visibility === 'private') return 'none';
  return row.link_role ?? 'viewer';
}

/**
 * What the SHARE LIST grants this actor. An anonymous token has no address and
 * no account, so it can never be named — it returns `none` without a query.
 *
 * The predicate is the union of the two the old pair used: a share matches by
 * its RESOLVED user id first, and by email only while still unresolved —
 * either the address this session carries, or the account's own, so an agent
 * arriving with a token (and therefore no session address) still reaches what
 * its person was invited to.
 */
async function namedRoleFor(
  row: Pick<ArtifactRow, 'id'>,
  actor: RoleActor,
): Promise<ArtifactRole> {
  if (!actor.userId) return 'none';
  const db = await getDb();
  await resolveSharesFor(db, row.id, actor.userId);
  const r = await db.query<{ role: ShareRole }>(
    `SELECT s.role FROM artifact_shares s
     WHERE s.artifact_id = $1 AND (
       s.user_id = $2
       OR (s.user_id IS NULL AND (s.email = $3 OR s.email = (SELECT email FROM users WHERE id = $2)))
     )`,
    [row.id, actor.userId, actor.email?.toLowerCase().trim() ?? ''],
  );
  return maxRole(...r.rows.map((x) => x.role as ArtifactRole));
}

// `link_role` is deliberately absent: SUMMARY_COLS does not select it, and a
// listing is an index rather than a bulk read. The general-access role is read
// through the sharing surface, where it is edited.
export type ArtifactSummary = Omit<ArtifactRow, 'content' | 'source' | 'token_id' | 'user_id' | 'actor_user_id' | 'actor_token_id' | 'link_role' | 'forked_from'>;

/** The stored representation of one artifact state (built by parseContentInput). */
export interface ArtifactInput {
  title?: string | null;
  description?: string | null;
  format: ArtifactFormat;
  content: string;
  source: string | null;
  meta: Record<string, unknown>;
  /** Absent on replace = keep the current value. */
  visibility?: Visibility;
  /** Absent on replace = keep the current value. Datasets only (routes refuse it elsewhere). */
  access?: DatasetAccess;
  /** Absent on replace = keep the current value. */
  folder?: string;
}

const SUMMARY_COLS = 'id, title, description, format, meta, version, visibility, access, folder, created_at, updated_at';

// ── Per-token quota ──────────────────────────────────────────────────────────

let quotaOverride: number | null = null;
/** Tests inject the cap here instead of mutating process.env (config is read once at import). */
export function setArtifactQuotaForTests(cap: number | null): void {
  quotaOverride = cap;
}

/** True when the token is at its artifact cap (0 ⇒ unlimited). Creation-time only — edits never block. */
export async function artifactQuotaExceeded(tokenId: string): Promise<boolean> {
  const cap = quotaOverride ?? ARTIFACT_QUOTA_PER_TOKEN;
  if (!cap) return false;
  const db = await getDb();
  const r = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM artifacts WHERE token_id = $1', [tokenId]);
  return (r.rows[0]?.n ?? 0) >= cap;
}

export async function createArtifact(
  tokenId: string,
  userId: string | null,
  input: ArtifactInput,
  /**
   * What only CREATION may set, deliberately NOT fields on ArtifactInput: that
   * shape is shared with the replace path, and neither of these is a thing a
   * content write may change.
   *   forkedFrom — provenance; written once and never updated.
   *   linkRole   — GENERAL ACCESS, the role the LINK grants. Every other
   *                creation leaves it NULL (which `linkRoleOf` reads as
   *                'viewer') and the sharing surface owns it afterwards; a
   *                FORK carries the source's, exactly as it carries visibility
   *                and access — the same axis, and carrying the tier while
   *                resetting the role would be incoherent.
   */
  atCreation: { forkedFrom?: string; linkRole?: ShareRole | null } = {},
): Promise<ArtifactRow> {
  const db = await getDb();
  // Birthday collisions at 62^6 are routine once the table is large, so the
  // PK-violation retry is a working path, not a theoretical one.
  const ID_MINT_ATTEMPTS = 5;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await db.query<ArtifactRow>(
        // The genesis edit row makes the creation's edit_id resolvable like any
        // other: an agent that creates and then edits against that id is on an
        // ordinary (if empty) base, not an unknown one. Data-modifying CTEs
        // always execute, so the log row lands even though nothing reads it.
        `WITH created AS (
           INSERT INTO artifacts (id, token_id, user_id, title, description, format, content, source, meta, visibility, link_role, folder, edit_id, access, forked_from, actor_user_id, actor_token_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $3, $2) RETURNING *
         ), genesis AS (
           INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id)
           SELECT id, edit_id, 0, '', COALESCE(source, content), 0, 0, $3, $2 FROM created
         )
         SELECT * FROM created`,
        [
          generateFileId(),
          tokenId,
          userId,
          input.title ?? null,
          input.description ?? null,
          input.format,
          input.content,
          input.source,
          JSON.stringify(input.meta),
          // Born private when someone owns it, public when nobody could ever
          // manage an ACL for it — except assets (images/datasets), born
          // unlisted: a public document reaches them at read time, and a
          // born-private ref bakes a 404 into every shared document that uses
          // it. Routes validate an explicit ask upstream.
          input.visibility ??
            (!userId ? (ALLOW_PUBLIC_VISIBILITY ? 'public' : 'unlisted')
              : input.format === 'image' || input.format === 'dataset' || input.format === 'pdf' ? 'unlisted' : 'private'),
          // NULL is the pre-column shape and reads as 'viewer' (linkRoleOf), so
          // every ordinary creation stays exactly as it was.
          atCreation.linkRole ?? null,
          input.folder ?? '',
          newEditId(),
          // Read-only unless the caller asked otherwise: a dataset that could
          // be written by default would make every existing document's data
          // mutable without anyone choosing it.
          input.access ?? 'read',
          atCreation.forkedFrom ?? null,
        ],
      );
      void trackEvent('create', r.rows[0].id, { userId });
      return r.rows[0];
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505' && attempt < ID_MINT_ATTEMPTS) continue;
      throw error;
    }
  }
}

/**
 * What a forker may change about the copy AS IT IS MADE — the three fields an
 * owner reaches for first. Every value here is already validated by the
 * caller through the shared parsers (lib/artifact-wire
 * `parseVisibilityValue`/`parseFolderField`), so this door does not
 * re-decide, for instance, whether an anonymous token may go private.
 */
export interface ForkOverrides {
  title?: string;
  visibility?: Visibility;
  folder?: string;
}

/**
 * FORK — the same artifact under a NEW OWNER and a new id, and nothing else.
 *
 * What travels is the CONTENT: format, title, description, visibility, access,
 * the whole meta (theme, template, compiled CSS, refs, dataset columns and
 * object key, image dimensions). Object-store bytes are REFERENCED rather than
 * re-uploaded — every key is content-addressed, so the copy's row names the
 * same one and a fork of a 27 MB sheet costs no bytes.
 *
 * What does not travel belongs to the ORIGINAL'S LIFE rather than its content:
 * version history (the copy is version 1 with its own genesis edit), comments
 * (every `data-annotation-anchor` is stripped — a copy starts with no
 * conversation), shares, and the folder it was filed in.
 *
 * A markup document is RE-PUBLISHED as the forker rather than row-copied, and
 * that is the whole point of the function: refs are resolved through
 * `refLoaderForActor(actor)` — the person taking the copy — so a document whose
 * <Mutation> writes the original owner's dataset is refused BY NAME at this
 * door instead of publishing and then failing every write at run time
 * (`writerFor` resolves as the document's owner, which the copy no longer is),
 * and one reading the owner's PRIVATE image or dataset is refused rather than
 * rendering broken for its new owner. The refusal Response passes through
 * verbatim. The data tiers have nothing to re-validate — their content is bytes
 * behind a key — so they are copied straight across.
 *
 * `overrides` are the three things a forker changes FIRST (the browser door
 * passes none; the agent operation passes what its caller sent, already
 * validated by the shared parsers). They are applied to the copy's stored
 * state rather than written afterwards: a post-hoc title would be a second
 * write, rotating the `edit_id` the create reply just handed back.
 */
export async function forkArtifact(
  actor: TokenActor,
  source: ArtifactRow,
  overrides: ForkOverrides = {},
): Promise<ArtifactRow | Response> {
  if (await artifactQuotaExceeded(actor.tokenId)) return json({ error: 'quota_exceeded', details: ['this token has hit its artifact COUNT quota — delete documents you no longer need'] }, 403);
  const input = await forkInput(actor, source, overrides);
  if (input instanceof Response) return input;
  const row = await createArtifact(actor.tokenId, actor.userId, input, { forkedFrom: source.id, linkRole: source.link_role });
  // Against the SOURCE: "this was forked" is a fact about the original, and the
  // forker is who did it. Never inside a transaction (PGLite deadlock).
  void trackEvent('fork', source.id, { userId: actor.userId, forkId: row.id });
  return row;
}

/** The copy's stored state, as the forker would have published it. */
async function forkInput(actor: TokenActor, source: ArtifactRow, overrides: ForkOverrides): Promise<ArtifactInput | Response> {
  // Everything the copy keeps that is not the content itself, with the
  // forker's overrides winning. `link_role` is carried too, but through
  // createArtifact's creation-only argument rather than here: it is not part
  // of ArtifactInput, which the replace path shares. With no `folder`
  // override, createArtifact's default puts the copy at the forker's root,
  // which is the only place they could have filed it.
  const carried = {
    title: overrides.title ?? source.title,
    description: source.description,
    visibility: overrides.visibility ?? source.visibility,
    access: source.access,
    ...(overrides.folder !== undefined ? { folder: overrides.folder } : {}),
  };
  if (source.format !== 'markup') {
    return { ...carried, format: source.format, content: source.content, source: source.source, meta: source.meta };
  }
  const meta = source.meta as { theme?: string; template?: string; colorMode?: 'light' | 'dark' | null };
  // Publish the LIVE vocabulary, exactly as the wire echo does: a stored
  // retired theme would otherwise make an old document unforkable for a reason
  // nobody could act on.
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode ?? null);
  const parsed = await parseContentInput({
    markup: sourceWithoutAnchors(source.source ?? ''),
    theme: design.theme,
    template: meta.template ?? null,
    colorMode: design.colorMode,
  }, {
    loadRef: refLoaderForActor(actor),
    importAsset: assetImporterFor(actor.tokenId, actor.userId),
    resolveFont: fontResolver(),
    overByteQuota: byteQuotaFor(actor.tokenId),
  });
  if (parsed instanceof Response) return parsed;
  const { derivedTitle: _derived, ...stored } = parsed;
  return { ...carried, ...stored };
}

async function getArtifact(tokenId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id = $1 AND token_id = $2', [id, tokenId]);
  return r.rows[0] ?? null;
}

async function getArtifactByUser(userId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id = $1 AND user_id = $2', [id, userId]);
  return r.rows[0] ?? null;
}

async function listArtifactsScoped(scope: Scope): Promise<ArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${SUMMARY_COLS} FROM artifacts WHERE ${scope.where('$1')} ORDER BY updated_at DESC LIMIT 100`,
    [scope.val],
  );
  return r.rows;
}

/**
 * Unscoped read for the public serving paths (/a/<id> and its sub-routes).
 * The id is an ADDRESS, not a credential — whether this viewer may see the
 * row is the caller's decision (the visibility ACL), made before serving.
 *
 * Request-memoized (React cache): the page resolves the row in
 * generateMetadata AND again in the render, and without the memo every view
 * pays the lookup twice. Outside an RSC render (route handlers, tests)
 * cache() is a pass-through, so it can never serve a stale row.
 */
export const getArtifactById = cache(async (id: string): Promise<ArtifactRow | null> => {
  const db = await getDb();
  const r = await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id = $1', [id]);
  return r.rows[0] ?? null;
});

/** Delete an artifact and its version history. Ownership-scoped; false = unknown/foreign. */
async function deleteArtifactScoped(scope: Scope, id: string): Promise<boolean> {
  const db = await getDb();
  // The event fires AFTER the transaction resolves: an unawaited query from
  // inside the callback would deadlock PGLite's serialized op queue.
  let ownerId: string | null = null;
  const deleted = await db.transaction(async (tx) => {
    const owned = await tx.query<{ user_id: string | null }>(`SELECT user_id FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
    if (owned.rows.length === 0) return false;
    ownerId = owned.rows[0].user_id;
    await tx.query('DELETE FROM artifact_versions WHERE artifact_id = $1', [id]);
    // The edit log stores full text (the genesis row holds the whole document),
    // so "permanent" delete must take it too or the content survives the delete.
    await tx.query('DELETE FROM artifact_edits WHERE artifact_id = $1', [id]);
    await tx.query('DELETE FROM artifact_shares WHERE artifact_id = $1', [id]);
    await tx.query('DELETE FROM annotations WHERE artifact_id = $1', [id]);
    await tx.query('DELETE FROM artifacts WHERE id = $1', [id]);
    return true;
  });
  if (deleted) void trackEvent('delete', id, { userId: ownerId });
  return deleted;
}

export interface VersionSummary {
  version: number;
  title: string | null;
  description: string | null;
  format: string;
  /** The handle of the account that produced this state; null for a token or an unnamed account. */
  by: string | null;
  created_at: string;
}

/** Archive the head as it stands — its author rides along, so history can say who. */
async function archiveVersion(tx: Queryable, current: ArtifactRow): Promise<void> {
  await tx.query(
    `INSERT INTO artifact_versions (artifact_id, version, title, description, format, content, source, meta, actor_user_id, actor_token_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [current.id, current.version, current.title, current.description, current.format, current.content, current.source, JSON.stringify(current.meta), current.actor_user_id, current.actor_token_id],
  );
}

/** The two actor columns a write stamps, in the order every statement binds them. */
const actorStamp = (actor: TokenActor): [string | null, string | null] => [actor.userId, actor.tokenId || null];

/**
 * WHO a statement over `artifacts` runs as: a predicate on the row, bound to
 * ONE parameter (`where('$2')` names the placeholder the caller puts `val`
 * in). Two constructors, and every scoped statement names which it holds:
 *
 *  - ownerScope  — the owner: user_id for an account, token_id for a bare
 *                  token. Delete, sharing, folder, dataset access, listing.
 *  - editorScope — the owner OR an account named `editor` in artifact_shares,
 *                  matched through users.email so a collaborator's CLAIMED
 *                  tokens edit too. Reach, edits, PUT, revert, versions.
 *
 * The predicate runs INSIDE the same WHERE as the id, so a miss is the uniform
 * 404 either way — there is no existence oracle in the difference.
 */
export type Scope = { where: (param: string) => string; val: string };

/**
 * An account holding one of `roles` on the row the enclosing statement is on.
 * A share is matched by its RESOLVED user id first, and by email only while
 * it is still unresolved (user_id NULL) — so a share follows the account
 * through an email change, and an old invite to an address the person no
 * longer has stops matching (share-resolution.test.ts).
 */
const SHARE_PREDICATE = (roles: readonly string[], param: string) =>
  `EXISTS (SELECT 1 FROM artifact_shares s
           WHERE s.artifact_id = artifacts.id AND s.role IN (${roles.map((r) => `'${r}'`).join(', ')})
             AND (s.user_id = ${param} OR (s.user_id IS NULL AND s.email = (SELECT email FROM users WHERE id = ${param}))))`;

/**
 * Stamp `user_id` on every still-unresolved share that matches this user's
 * current email — the moment of RESOLUTION. Idempotent; a no-op once stamped.
 */
async function resolveSharesFor(db: Queryable, artifactId: string, userId: string): Promise<void> {
  await db.query(
    `UPDATE artifact_shares SET user_id = $2 WHERE artifact_id = $1 AND user_id IS NULL AND email = (SELECT email FROM users WHERE id = $2)`,
    [artifactId, userId],
  );
}

const ownerScope = ({ tokenId, userId }: TokenActor): Scope =>
  userId ? { where: (p) => `user_id = ${p}`, val: userId } : { where: (p) => `token_id = ${p}`, val: tokenId };

/**
 * The SQL MIRROR of the lattice: the owner, or an account holding any share
 * role that reaches `min`. One generator rather than a hand-written predicate
 * per door, so "which roles may edit" is answered in the same place for the
 * statement and for the page (lib/share-roles shareRolesAtLeast) — and so the
 * LINK term, when it arrives, is added once here rather than three times.
 *
 * An anonymous token has no account to be named through, so it narrows to
 * bare ownership.
 */
/**
 * The LINK half of the same lattice, in SQL. Only ever composed into a scope
 * that has already narrowed to an actor with an ACCOUNT (scopeAtLeast below),
 * which is where the anonymous ceiling is enforced for statements — the mirror
 * of what effectiveRole does for reads.
 *
 * COALESCE carries the pre-column rows: NULL is `viewer`, exactly what they
 * already granted.
 */
const LINK_PREDICATE = (min: ArtifactRole) =>
  `(artifacts.visibility <> 'private' AND COALESCE(artifacts.link_role, 'viewer') IN (${shareRolesAtLeast(min).map((r) => `'${r}'`).join(', ')}))`;

const scopeAtLeast = (actor: TokenActor, min: ArtifactRole): Scope =>
  actor.userId
    ? { where: (p) => `(user_id = ${p} OR ${SHARE_PREDICATE(shareRolesAtLeast(min), p)} OR ${LINK_PREDICATE(min)})`, val: actor.userId }
    : ownerScope(actor);

const editorScope = (actor: TokenActor): Scope => scopeAtLeast(actor, 'editor');

/**
 * The scope the annotation sidecar reaches a document through: the owner, an
 * editor, or a COMMENTER (lib/annotations).
 *
 * It was `ownerScope`, and that was an accident rather than a decision — a
 * collaborator who may rewrite the document met the uniform 404 on the way to
 * commenting on it. A document two people may WRITE should not be a document
 * only one may DISCUSS, and a commenter is someone invited to discuss it and
 * nothing else. Deletion does NOT use this (see deleteAnnotationFor): erasing
 * someone else's words is the owner's verb.
 */
export const annotationScope = (actor: TokenActor): Scope => scopeAtLeast(actor, 'commenter');

async function getArtifactScoped(scope: Scope, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await db.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  return r.rows[0] ?? null;
}

/**
 * Whole-document writes (PUT, revert) join the edit protocol rather than
 * sitting outside it: they mint a fresh `edit_id`, log one splice covering the
 * entire old document — so every edit still based on an older version overlaps
 * it and is correctly rejected as `doc_changed` — and wake live readers.
 * Callers must already hold the row inside `tx`.
 */
async function logWholeDocumentWrite(tx: Queryable, before: ArtifactRow, after: ArtifactRow): Promise<void> {
  const oldText = before.source ?? before.content;
  const newText = after.source ?? after.content;
  await tx.query(
    `INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id)
     VALUES ($1, $2, 0, $3, $4, 0, $5, $6, $7)`,
    [after.id, after.edit_id, oldText, newText, oldText.length, after.actor_user_id, after.actor_token_id],
  );
  // Lowercased to match channelFor (lib/story/live.ts) — see the note there.
  await tx.query('SELECT pg_notify($1, $2)', [`artifact_${after.id.toLowerCase()}`, after.edit_id]);
}

async function listVersionsScoped(scope: Scope, id: string): Promise<VersionSummary[] | null> {
  const db = await getDb();
  const owned = await db.query(`SELECT 1 FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  if (owned.rows.length === 0) return null;
  const r = await db.query<VersionSummary>(
    `SELECT v.version, v.title, v.description, v.format, u.username AS by, v.created_at
     FROM artifact_versions v LEFT JOIN users u ON u.id = v.actor_user_id
     WHERE v.artifact_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

export interface VersionContent extends VersionSummary {
  content: string;
  source: string | null;
  meta: Record<string, unknown>;
}

/** One archived version WITH content (the editor's version viewer). */
async function getVersionScoped(scope: Scope, id: string, version: number): Promise<VersionContent | null> {
  const db = await getDb();
  const owned = await db.query(`SELECT 1 FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  if (owned.rows.length === 0) return null;
  const r = await db.query<VersionContent>(
    `SELECT v.version, v.title, v.description, v.format, v.content, v.source, v.meta, u.username AS by, v.created_at
     FROM artifact_versions v LEFT JOIN users u ON u.id = v.actor_user_id
     WHERE v.artifact_id = $1 AND v.version = $2`,
    [id, version],
  );
  return r.rows[0] ?? null;
}

/**
 * Revert to an archived version — as a NEW version (the current state is
 * archived first), so a revert is itself revertible and the URL never moves.
 * Null when the artifact or the requested version doesn't exist.
 */
/**
 * Asked for a version of an artifact that exists and is theirs, but which was
 * never archived. Save-less editing bumps `version` on every accepted edit
 * while snapshots COALESCE, so most version numbers are checkpoints that were
 * skipped — and answering the uniform 404 there would claim the artifact does
 * not exist. Ownership is already proved by this point, so naming the real
 * reason leaks nothing. `GET /versions` lists what can actually be restored.
 */
export interface VersionNotArchived {
  notArchived: true;
}
export function isVersionNotArchived(r: ArtifactRow | null | VersionNotArchived): r is VersionNotArchived {
  return r !== null && 'notArchived' in r;
}

async function revertScoped(actor: TokenActor, id: string, version: number): Promise<ArtifactRow | null | VersionNotArchived> {
  const db = await getDb();
  const scope = editorScope(actor);
  // Event fires post-txn — see deleteArtifactScoped for why.
  const result: ArtifactRow | null | VersionNotArchived = await db.transaction(async (tx) => {
    const current = (
      await tx.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])
    ).rows[0];
    if (!current) return null;
    const target = (
      await tx.query<ArtifactRow>(
        'SELECT title, description, format, content, source, meta FROM artifact_versions WHERE artifact_id = $1 AND version = $2',
        [id, version],
      )
    ).rows[0];
    if (!target) return { notArchived: true };

    await archiveVersion(tx, current);
    const updated = await tx.query<ArtifactRow>(
      `UPDATE artifacts
       SET title = $3, description = $4, format = $5, content = $6, source = $7, meta = $8, version = version + 1,
           edit_id = $9, actor_user_id = $10, actor_token_id = $11, updated_at = now()
       WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
      [id, scope.val, target.title, target.description, target.format, target.content, target.source, JSON.stringify(target.meta), newEditId(), ...actorStamp(actor)],
    );
    await logWholeDocumentWrite(tx, current, updated.rows[0]);
    return updated.rows[0];
  });
  if (result && !isVersionNotArchived(result)) void trackEvent('revert', result.id, { userId: result.user_id });
  return result;
}

/**
 * Full replace: archive the current state to artifact_versions, then overwrite
 * with version+1 (format may switch html↔story). Omitted title/description
 * keep their current values. Null when no artifact matches (unknown/foreign).
 */

/**
 * Optimistic-concurrency miss: the caller's `expectedVersion` no longer names
 * the head. Distinct from `null` (unknown/foreign) — routes answer 409, not
 * 404, and report the head version so the caller can read → merge → replay.
 */
export interface VersionConflict {
  conflict: true;
  currentVersion: number;
}
export function isVersionConflict(r: ArtifactRow | null | VersionConflict): r is VersionConflict {
  return r !== null && 'conflict' in r;
}

export interface ReplaceOpts {
  /** When set, the replace applies only if it still names the head version. */
  expectedVersion?: number;
}

async function replaceScoped(
  actor: TokenActor,
  id: string,
  input: ArtifactInput,
  opts: ReplaceOpts = {},
): Promise<ArtifactRow | null | VersionConflict> {
  const db = await getDb();
  const scope = editorScope(actor);
  // Event fires post-txn — see deleteArtifactScoped for why.
  const result: ArtifactRow | null | VersionConflict = await db.transaction(async (tx) => {
    const current = (
      await tx.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])
    ).rows[0];
    if (!current) return null;
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
      return { conflict: true, currentVersion: current.version };
    }

    await archiveVersion(tx, current);

    const updated = await tx.query<ArtifactRow>(
      `UPDATE artifacts
       SET format = $3, content = $4, source = $5, meta = $6, title = $7, description = $8,
           visibility = COALESCE($10, visibility), folder = COALESCE($11, folder),
           access = COALESCE($12, access),
           version = version + 1, edit_id = $9, actor_user_id = $13, actor_token_id = $14, updated_at = now()
       WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
      [
        id,
        scope.val,
        input.format,
        input.content,
        input.source,
        JSON.stringify(input.meta),
        input.title !== undefined ? input.title : current.title,
        input.description !== undefined ? input.description : current.description,
        newEditId(),
        input.visibility ?? null,
        input.folder ?? null,
        input.access ?? null,
        ...actorStamp(actor),
      ],
    );
    await logWholeDocumentWrite(tx, current, updated.rows[0]);
    return updated.rows[0];
  });
  if (result && !isVersionConflict(result)) void trackEvent('update', result.id, { userId: result.user_id });
  return result;
}

// ── The concurrent-edit protocol (concurrent-artifacts-edits.md) ─────────────

/**
 * One edit against a claimed base version. Agents send the Edit-tool diff;
 * the WYSIWYG sends its whole re-serialized source (the splice is derived by
 * prefix/suffix diff — sound because stored source is canonical).
 */
export interface EditInput {
  baseEditId: string;
  /** The content change, if this edit has one. */
  change?: { oldString: string; newString: string } | { newSource: string };
  /**
   * Document-level attributes. Deliberately NOT node-scoped: a title or theme
   * belongs to the whole document, has no span to conflict on, and (for theme)
   * recompiles the stylesheet — so these apply to head and never reject, which
   * is what lets the editor persist a theme flip while an agent is writing.
   */
  meta?: { title?: string | null; theme?: string | null; colorMode?: 'light' | 'dark' | null };
}

/**
 * The resolution outcomes (doc: "Resolution, step by step"). `null` keeps the
 * uniform-404 contract: unknown and foreign ids are indistinguishable.
 * Candidate markup that fails validation returns the publish pipeline's 400
 * Response unchanged (same shape as parseContentInput).
 */
export type EditOutcome =
  /** `warnings`: external URLs the candidate named that would not import (lib/web-assets). */
  | { applied: true; row: ArtifactRow; warnings?: AssetWarning[] }
  | { applied: false; reason: 'stale_edit_id' | 'doc_changed'; head: { editId: string; source: string; version: number } }
  | { applied: false; reason: 'bad_diff'; detail: 'no_match' | 'multiple_matches' | 'identical' }
  | { applied: false; reason: 'not_editable' }; // data tiers are values, not documents

/**
 * Save-less editing writes constantly, so `artifact_versions` snapshots
 * coalesce: the first edit after this much quiet archives the pre-edit state,
 * everything inside the burst rides on it. The decision is made in SQL (a NOT
 * EXISTS over the edit log) so it costs no extra round trip.
 */
const EDIT_SNAPSHOT_WINDOW_MS = 120_000;

/** How many times a lost CAS race is retried before we give up and report the conflict. */
const EDIT_CAS_RETRIES = 3;

/**
 * How far behind head a base may be and still be resolved. Reconstructing a
 * base means inverse-applying every edit after it, so an unbounded lag is
 * unbounded work — and a caller that far behind is better served re-reading
 * than rebasing. Refusing is safe: `stale_edit_id` carries head, which is
 * exactly what they need. This is also what makes the log prunable.
 */
export const MAX_STALE_EDITS = 200;

/** The log rows written after `baseEditId`, oldest→newest; null when that id is unknown here. */
async function interveningEdits(q: Queryable, artifactId: string, baseEditId: string): Promise<EditRecord[] | null> {
  const r = await q.query<{
    seq: string; edit_id: string; splice_start: number; removed: string; inserted: string; span_start: number; span_end: number;
  }>(
    `SELECT seq, edit_id, splice_start, removed, inserted, span_start, span_end FROM artifact_edits
     WHERE artifact_id = $1 AND seq > (SELECT seq FROM artifact_edits WHERE artifact_id = $1 AND edit_id = $2)
     ORDER BY seq`,
    [artifactId, baseEditId],
  );
  // The subselect yields NULL for an unknown base, and `seq > NULL` matches
  // nothing — indistinguishable from "no intervening edits", so confirm the
  // base actually exists before trusting an empty list.
  if (r.rows.length === 0) {
    const known = await q.query('SELECT 1 FROM artifact_edits WHERE artifact_id = $1 AND edit_id = $2', [artifactId, baseEditId]);
    if (known.rows.length === 0) return null;
  }
  return r.rows.map((row) => ({
    seq: Number(row.seq), // BIGSERIAL arrives as a string from the pg driver
    editId: row.edit_id,
    splice: { start: row.splice_start, removed: row.removed, inserted: row.inserted },
    span: { start: row.span_start, end: row.span_end },
  }));
}

const headOf = (row: ArtifactRow) => ({ editId: row.edit_id, source: row.source ?? '', version: row.version });

/**
 * Resolve one edit: fast path = single guarded CTE (UPDATE + archive + log
 * INSERT + NOTIFY) when the base is head; slow path = shift through
 * intervening log rows, apply iff node-disjoint. Fail closed everywhere: a CAS
 * miss retries (bounded), a shift that lands on text ≠ `removed` rejects as
 * doc_changed. The logged splice is always the delta between STORED versions
 * (post-sanitize), never the caller's literal diff, so reconstruction from any
 * still-logged base is exact.
 */
export async function applyEditScoped(actor: TokenActor, id: string, input: EditInput, opts: { scope?: Scope } = {}): Promise<EditOutcome | Response | null> {
  const db = await getDb();
  // Who may reach the row: editors by default; an annotation anchor stamp
  // (lib/annotations) widens it to commenters, whose only "edit" this is.
  const scope = opts.scope ?? editorScope(actor);

  for (let attempt = 0; ; attempt++) {
    const head = (
      await db.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])
    ).rows[0];
    if (!head) return null;
    // Documents edit; VALUES do not. A dataset/viz/image is a blob whose
    // meaning lives in its structure, so a text splice into it is meaningless.
    if (head.format !== 'markup') return { applied: false, reason: 'not_editable' };

    // The document's truth is `source` (markup rows keep `content` empty).
    const headSource = head.source ?? '';

    // 1. Resolve the claimed base: head itself, or a still-logged ancestor.
    let intervening: EditRecord[] = [];
    if (input.baseEditId !== head.edit_id) {
      const found = await interveningEdits(db, id, input.baseEditId);
      // Unknown, or so far behind that rebasing is worse than re-reading —
      // both answer with head, which is all the caller needs either way.
      if (found === null || found.length > MAX_STALE_EDITS) {
        return { applied: false, reason: 'stale_edit_id', head: headOf(head) };
      }
      intervening = found;
    }
    const baseSource = reconstructBaseSource(headSource, intervening);

    // 2. Derive the splice in the BASE's coordinates — anchoring on the version
    //    the caller actually read is what makes a stale base resolvable at all.
    //    A metadata-only edit has no splice and skips straight to the write.
    let candidate = headSource;
    if (input.change) {
      let splice: Splice;
      if ('oldString' in input.change) {
        const derived = deriveSpliceFromStrings(baseSource, input.change.oldString, input.change.newString);
        if (!derived.ok) return { applied: false, reason: 'bad_diff', detail: derived.reason };
        splice = derived.splice;
      } else {
        const derived = deriveSpliceByDiff(baseSource, canonicalizeMarkup(input.change.newSource));
        if (!derived) {
          // No text change. Fine when metadata is also being set; otherwise
          // there is nothing to do.
          if (!input.meta) return { applied: false, reason: 'bad_diff', detail: 'identical' };
          splice = { start: 0, removed: '', inserted: '' };
        } else {
          splice = derived;
        }
      }

      // 3. Place it at the best-scoped position among its equivalents, then
      //    carry it to head coords, rejecting when an intervening edit touched
      //    the same node. Without normalization a whole-document submission
      //    (every editor flush) can land inside a tag and touch everything.
      splice = normalizeSplice(baseSource, splice);
      const shifted = shiftThroughEdits(
        { splice, span: touchedSpanFor(baseSource, splice) },
        intervening,
      );
      if (!shifted.ok) return { applied: false, reason: 'doc_changed', head: headOf(head) };
      // Defence in depth: the shifted range must still name the text it claims.
      const at = headSource.slice(shifted.splice.start, shifted.splice.start + shifted.splice.removed.length);
      if (at !== shifted.splice.removed) return { applied: false, reason: 'doc_changed', head: headOf(head) };
      candidate = applySplice(headSource, shifted.splice);
    } else if (!input.meta) {
      return { applied: false, reason: 'bad_diff', detail: 'identical' };
    }

    // 4. Validate/sanitize/compile the candidate — a pure function of content,
    //    so it runs with no lock held (a concurrent landing just loses the CAS).
    //    Theme/colorMode ride along because they change the compiled stylesheet.
    const meta = head.meta as { theme?: unknown; template?: unknown; colorMode?: unknown };
    const published = await publishJsx(
      {
        theme: input.meta?.theme !== undefined ? input.meta.theme : meta.theme ?? null,
        template: meta.template ?? null,
        colorMode: input.meta?.colorMode !== undefined ? input.meta.colorMode : meta.colorMode ?? null,
      },
      candidate,
      {
        // Refs resolve as the DOCUMENT's owner, never the writer: an editor's
        // edit to a document carrying its owner's <Mutation> or private image
        // must not fail on assets the editor could never own. Same rule as
        // the importer below and runDocumentMutation.
        loadRef: refLoaderForActor(writerFor(head)),
        // An agent pasting a web image mid-edit imports like a publish would;
        // the created asset belongs to whoever the DOCUMENT belongs to.
        importAsset: assetImporterFor(head.token_id, head.user_id),
        resolveFont: fontResolver(),
        overByteQuota: byteQuotaFor(head.token_id),
      },
    );
    if (published instanceof Response) return published;
    const storedText = published.source ?? '';

    // 5. Log what actually LANDED (the sanitizer may have rewritten the text),
    //    normalized for the same reason: the logged span is what every future
    //    stale-base edit is tested against.
    const rawStored = deriveSpliceByDiff(headSource, storedText);
    if (!rawStored && !input.meta) return { applied: false, reason: 'bad_diff', detail: 'identical' };
    // A metadata-only write logs a zero-width edit: it moves the head pointer
    // and wakes watchers, but touches no node, so it conflicts with nothing.
    const storedSplice = rawStored ? normalizeSplice(headSource, rawStored) : { start: 0, removed: '', inserted: '' };
    const storedSpan = rawStored ? touchedSpanFor(headSource, storedSplice) : { start: 0, end: 0 };

    const freshEditId = newEditId();
    const updated = await db.query<ArtifactRow>(
      `WITH updated AS (
         UPDATE artifacts SET content = $3, source = $4, meta = $5, version = version + 1,
                edit_id = $6, title = $21, actor_user_id = $22, actor_token_id = $23, updated_at = now()
         WHERE id = $1 AND ${scope.where('$2')} AND edit_id = $7
         RETURNING *
       ), archived AS (
         INSERT INTO artifact_versions (artifact_id, version, title, description, format, content, source, meta, actor_user_id, actor_token_id)
         SELECT $1, $8, $9, $10, $11, $12, $13, $14::jsonb, $24, $25
         WHERE EXISTS (SELECT 1 FROM updated)
           -- Coalesce on ARCHIVING activity, not edit activity: the first edit
           -- after a quiet spell preserves the pre-edit state (including the
           -- created draft), and the rest of the burst rides on that snapshot.
           AND NOT EXISTS (
             SELECT 1 FROM artifact_versions
             WHERE artifact_id = $1 AND created_at > now() - ($15::int * interval '1 millisecond')
           )
         ON CONFLICT DO NOTHING
       ), logged AS (
         INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id)
         SELECT id, $6, $16, $17, $18, $19, $20, $22, $23 FROM updated
         RETURNING pg_notify('artifact_' || lower(artifact_id), $6)
       )
       SELECT u.* FROM updated u WHERE EXISTS (SELECT 1 FROM logged)`,
      [
        id, scope.val,
        published.content, published.source, JSON.stringify(published.meta), freshEditId, head.edit_id,
        head.version, head.title, head.description, head.format, head.content, head.source, JSON.stringify(head.meta),
        EDIT_SNAPSHOT_WINDOW_MS,
        storedSplice.start, storedSplice.removed, storedSplice.inserted, storedSpan.start, storedSpan.end,
        input.meta?.title !== undefined ? input.meta.title : head.title,
        ...actorStamp(actor),
        head.actor_user_id, head.actor_token_id,
      ],
    );
    if (updated.rows[0]) {
      void trackEvent('edit', updated.rows[0].id, { userId: updated.rows[0].user_id });
      return { applied: true, row: updated.rows[0], ...(published.warnings?.length ? { warnings: published.warnings } : {}) };
    }
    // Lost the CAS: someone landed between our read and our write. Re-read and
    // redo — our base is now an ordinary stale base, so the node-scope check
    // decides it. (Near-unreachable on PGLite, which serializes all ops.)
    if (attempt >= EDIT_CAS_RETRIES) {
      const now = (await db.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])).rows[0];
      return now ? { applied: false, reason: 'doc_changed', head: headOf(now) } : null;
    }
  }
}

/**
 * Move a file between folders — metadata only: no version bump, no edit-log
 * row, no content change (a move is not an edit of the document). The
 * canonical URL follows automatically because it is derived, and old links
 * keep working because resolution is by id. Null = unknown/foreign.
 */
/**
 * Open (or close) a dataset for writes — metadata only, exactly like a folder
 * move: no version bump, no edit-log row, no content change. The rows are not
 * touched; only who may change them from here on. Closing is always safe for
 * the data (every mutate call re-checks), it only stops the documents that
 * write — which is why the share menu names them first.
 */
export function setAccessFor(actor: TokenActor, id: string, access: DatasetAccess): Promise<ArtifactRow | null> {
  return setAccessScoped(ownerScope(actor), id, access);
}

async function setAccessScoped(scope: Scope, id: string, access: DatasetAccess): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await db.query<ArtifactRow>(
    `UPDATE artifacts SET access = $3 WHERE id = $1 AND ${scope.where('$2')} AND format = 'dataset' RETURNING *`,
    [id, scope.val, access],
  );
  return r.rows[0] ?? null;
}

async function setFolderScoped(scope: Scope, id: string, folder: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await db.query<ArtifactRow>(
    `UPDATE artifacts SET folder = $3 WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
    [id, scope.val, folder],
  );
  return r.rows[0] ?? null;
}

// ── Sharing (the private tier's ACL surface) ─────────────────────────────────

export interface SharingState {
  visibility: Visibility;
  /** What the link grants — the general-access role beside the general-access tier. */
  linkRole: ShareRole;
  /** The named people, by email, with their role — sorted by email. */
  shares: ShareEntry[];
  /** Datasets: the write ACL, and the documents that would stop working if it were closed. */
  access?: DatasetAccess;
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
  /** False for an anonymous owner: `private` has no ACL to anchor without an account. */
  canPrivate?: boolean;
}

/**
 * Owner-only read of an artifact's ACL. Null = unknown/foreign (uniform 404).
 *
 * Scoped by ACTOR, not by account: an ANONYMOUS owner has an ACL to manage
 * too, now that `access` lives here — writes anchor on the creating token, not
 * on an account. (`private` still needs one, and `canPrivate` says so, which
 * is what keeps the UI from offering a tier the door would refuse.)
 */
export async function getSharingFor(actor: TokenActor, id: string): Promise<SharingState | null> {
  const db = await getDb();
  const row = await getOwnedArtifactFor(actor, id);
  if (!row) return null;
  const shares = await db.query<ShareEntry>(
    'SELECT email, role FROM artifact_shares WHERE artifact_id = $1 ORDER BY email',
    [id],
  );
  return {
    visibility: row.visibility,
    linkRole: (row.link_role ?? 'viewer') as ShareRole,
    shares: shares.rows,
    canPrivate: !!actor.userId,
    ...(row.format === 'dataset'
      ? { access: row.access, writtenBy: await findWritersFor(actor, id) }
      : {}),
  };
}

/** What the sharing surface may change, all optional — absent means untouched. */
export interface SharingPatch {
  visibility?: Visibility;
  shares?: ShareEntry[];
  access?: DatasetAccess;
  /** What the link grants. Stored even while `private`, where `linkRoleOf` ignores it — so flipping back to a link-readable tier restores the choice rather than silently resetting it. */
  linkRole?: ShareRole;
}

/**
 * Owner-only update of an artifact's ACL. `shares` is FULL-REPLACE (the UI
 * always sends the whole list — idempotent, no add/remove protocol). Emails
 * are normalized to lowercase and collapsed — the LAST role given for an
 * address wins; the route validates shape and role names upstream.
 */
export async function updateSharingFor(actor: TokenActor, id: string, patch: SharingPatch): Promise<SharingState | null> {
  const db = await getDb();
  const scope = ownerScope(actor);
  const done = await db.transaction(async (tx) => {
    const owned = await tx.query(`SELECT 1 FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
    if (owned.rows.length === 0) return false;
    if (patch.visibility) {
      await tx.query(`UPDATE artifacts SET visibility = $3 WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val, patch.visibility]);
    }
    if (patch.linkRole) {
      await tx.query(`UPDATE artifacts SET link_role = $3 WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val, patch.linkRole]);
    }
    if (patch.access) {
      // Datasets only — the SQL says so rather than the caller, so a document
      // can never acquire a write ACL by way of this surface.
      await tx.query(`UPDATE artifacts SET access = $3 WHERE id = $1 AND ${scope.where('$2')} AND format = 'dataset'`, [id, scope.val, patch.access]);
    }
    if (patch.shares) {
      const entries = new Map(patch.shares.map((e) => [e.email.toLowerCase().trim(), e.role]));
      await tx.query('DELETE FROM artifact_shares WHERE artifact_id = $1', [id]);
      for (const [email, role] of entries) {
        await tx.query('INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, $3)', [id, email, role]);
      }
    }
    return true;
  });
  if (!done) return null;
  return getSharingFor(actor, id);
}

export async function updateSharing(userId: string, id: string, patch: SharingPatch): Promise<SharingState | null> {
  return updateSharingFor({ tokenId: '', userId }, id, patch);
}

// ── The reference graph ──────────────────────────────────────────────────────

/**
 * A ref target ANY caller may use: link-readable, exactly the anonymous
 * viewer's cut of canReadArtifact. Assets and documents routinely land under
 * different identities (two agent sessions each on their own anonymous token;
 * an unclaimed upload referenced from an account-owned doc), and anonymous
 * assets are born public — so ownership-scoping made "publish the image, then
 * reference it" fail for no reason the user could see. PRIVATE stays invisible
 * cross-identity: the same uniform "does not resolve" as a nonexistent id,
 * never an existence oracle.
 */
async function getLinkReadableArtifact(id: string): Promise<ArtifactRow | null> {
  const row = await getArtifactById(id);
  return row && row.visibility !== 'private' ? row : null;
}

/** Resolve a `ref:<id>`: the caller's own artifacts, then anything link-readable. */
function refLoaderFor(tokenId: string): RefLoader {
  return async (id: string): Promise<ResolvedRef | null> => {
    // `owned` records WHICH branch answered: a read is happy either way, a
    // <Mutation> is admitted only for the caller's own (lib/story/refs).
    const own = await getArtifact(tokenId, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/** Same, scoped by account (the session-authed /api/my routes) before the link-readable fallback. */
function refLoaderForUser(userId: string): RefLoader {
  return async (id: string): Promise<ResolvedRef | null> => {
    const own = await getArtifactByUser(userId, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/**
 * THE PUBLISH DOOR'S ASSET IMPORTER: one external URL → one row in the global
 * URL cache (lib/web-assets), charged to whoever the DOCUMENT belongs to.
 *
 * It answers a WARNING rather than a Response, because a URL that will not
 * import must not cost an author their document: the publish succeeds, the
 * reply names what failed and what to do, and the served `<img>` draws its alt
 * text. The hourly fetch allowance is the same one every web import pays
 * (lib/auth) — probing is the abuse shape and probes fail, so ATTEMPTS are what
 * is counted. The byte quota is charged inside `importWebAsset`, at the one
 * door that turns a URL into stored bytes.
 *
 * This replaced an importer that created an image ARTIFACT per URL and rewrote
 * the source to `ref:<id>`: an agent got documents it never asked for, in a
 * markup it no longer recognised, and re-publishing the same URL made another.
 */
export function assetImporterFor(tokenId: string, userId: string | null): (url: string, kind: WebAssetKind) => Promise<AssetWarning | null> {
  return async (url, kind) => {
    if (webIngestRateLimited(`ingest:${tokenId}`)) {
      return { code: 'rate_limited', url, fix: 'too many web imports this hour — try again later' };
    }
    try {
      await importWebAsset(url, { tokenId, userId }, kind);
      return null;
    } catch (error) {
      if (error instanceof WebAssetRefused) return assetWarningFor(error);
      throw error;
    }
  };
}

/**
 * The byte quota as the publish door asks it: "is this caller already over?"
 *
 * A closure over the identity, so lib/story/input can guard a tier without
 * knowing who is publishing (the shape assetImporterFor established). The
 * subject is the ACCOUNT when the token has one — a cap keyed on the token
 * alone is bypassed by minting a second one — which lib/asset-quota decides,
 * not this.
 *
 * Its ABSENCE is also what tells the byte tiers they are being previewed:
 * every other ctx member degrades to "do less", and storing the bytes IS what
 * publishing an image or a PDF is, so those two refuse by name instead of
 * quietly working for free (lib/story/input).
 */
export function byteQuotaFor(tokenId: string): () => Promise<boolean> {
  return () => assetByteQuotaExceeded(tokenId);
}

/**
 * The publish door's font resolver: a family the document names becomes faces
 * copied into our object store (lib/webfonts), once per deployment. Failure is
 * a 400 that NAMES the family — the same stance the image door takes, and for
 * the same reason: a silent fallback renders as "it worked".
 */
export function fontResolver(): (family: string) => Promise<Response | null> {
  return async (family) => {
    try {
      await resolveWebFont(family);
      return null;
    } catch (error) {
      if (error instanceof UnknownFontError) {
        return json({ error: 'unknown_font', details: [error.message] }, 400);
      }
      throw error;
    }
  };
}

// ── The bearer actor ─────────────────────────────────────────────────────────
//
// A presented token acts in ONE of the two scopes above. A token claimed by an
// account acts ACCOUNT-WIDE: any of a user's tokens may read, edit, and manage
// anything the user owns, because handing an agent a token IS handing it the
// account's documents — a second agent must be able to pick up a document the
// first one created. (Render-time ref resolution already widened this way; see
// refDataForRow.) An anonymous token reaches only what it itself created —
// there is no account to widen to, so the token-scope boundary stands.
//
// Safe because creation stamps user_id from the token and claiming backfills
// it: a user-owned token cannot have artifacts its user scope would miss.

export interface TokenActor {
  tokenId: string;
  userId: string | null;
}

/** The actor's REACH: what they own, and what they are named editor on. */
export function getArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(editorScope(actor), id);
}

/** What the actor OWNS — the read behind every owner-only surface (sharing, metadata, delete). */
export function getOwnedArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(ownerScope(actor), id);
}

export function listArtifactsFor(actor: TokenActor): Promise<ArtifactSummary[]> {
  return listArtifactsScoped(ownerScope(actor));
}

export function replaceArtifactFor(actor: TokenActor, id: string, input: ArtifactInput, opts: ReplaceOpts = {}): Promise<ArtifactRow | VersionConflict | null> {
  return replaceScoped(actor, id, input, opts);
}

export function applyEditFor(actor: TokenActor, id: string, input: EditInput, opts: { scope?: Scope } = {}): Promise<EditOutcome | Response | null> {
  return applyEditScoped(actor, id, input, opts);
}

export function listVersionsFor(actor: TokenActor, id: string): Promise<VersionSummary[] | null> {
  return listVersionsScoped(editorScope(actor), id);
}

export function getVersionFor(actor: TokenActor, id: string, version: number): Promise<VersionContent | null> {
  return getVersionScoped(editorScope(actor), id, version);
}

export function revertArtifactFor(actor: TokenActor, id: string, version: number): Promise<ArtifactRow | null | VersionNotArchived> {
  return revertScoped(actor, id, version);
}

export function deleteArtifactFor(actor: TokenActor, id: string): Promise<boolean> {
  return deleteArtifactScoped(ownerScope(actor), id);
}

export function setFolderFor(actor: TokenActor, id: string, folder: string): Promise<ArtifactRow | null> {
  return setFolderScoped(ownerScope(actor), id, folder);
}

export function refLoaderForActor(actor: TokenActor): RefLoader {
  return actor.userId ? refLoaderForUser(actor.userId) : refLoaderFor(actor.tokenId);
}

function rowToResolvedRef(row: ArtifactRow, owned = false): ResolvedRef {
  const meta = row.meta as { columns?: DatasetColumn[] };
  return {
    id: row.id,
    format: row.format,
    owned,
    ...(row.format === 'dataset' ? { columns: meta.columns ?? [], access: row.access } : {}),
    ...(row.format === 'viz' ? { recipe: JSON.parse(row.content) } : {}),
  };
}

// ── Writable datasets ────────────────────────────────────────────────────────


/** Why a write may not happen. Each names the fix; none is an existence oracle. */
export type WriteRefusal = 'not_a_dataset' | 'dataset_read_only';

/**
 * MAY this dataset be written on behalf of this owner? The one definition,
 * used by the publish door's ref check, the document's mutate route and the
 * owner's own mutate route — so "who may write" cannot drift between the
 * moment a document is published and the moment someone clicks its button.
 *
 * Two conditions, both re-checked on EVERY call rather than trusted from
 * publish time: the row is a dataset whose owner opened it for writes, and
 * the writer OWNS it. Ownership is the artifact scope, not the read ACL — a
 * public dataset is readable by anyone's document and writable by none of
 * theirs, because "anyone may read this" has never meant "anyone may append
 * to it".
 */
export function canWriteDataset(dataset: ArtifactRow, owner: { tokenId: string; userId: string | null }): WriteRefusal | null {
  if (dataset.format !== 'dataset') return 'not_a_dataset';
  const owns = owner.userId ? dataset.user_id === owner.userId : dataset.token_id === owner.tokenId;
  // An unreachable dataset is reported as read-only, never as "not yours":
  // the caller answers a uniform 404 for anything it could not resolve, and
  // this one it could — the document names it, so its existence is not news.
  if (!owns) return 'dataset_read_only';
  return dataset.access === 'readwrite' ? null : 'dataset_read_only';
}

/**
 * The document's own writer identity — who its mutations act as. A document
 * publishes under a token and (once claimed) an account, and its mutations
 * write that owner's datasets, for whoever may read the document. This is
 * what makes a reader's click safe: it never carries the READER's identity,
 * only the document's, and the document may only name datasets its own
 * publisher owns (validateRefs).
 */
export const writerFor = (doc: ArtifactRow): TokenActor => ({ tokenId: doc.token_id, userId: doc.user_id });

/**
 * Run one of a stored document's declared mutations. Everything a reader
 * supplies is scalar VALUES; the SQL and the target come from the stored
 * source, so a caller can never write anything the author did not publish.
 */
export type DocumentMutationOutcome =
  | { ok: true; dataset: ArtifactRow; affected: number; rowCount: number }
  | { ok: false; reason: 'unknown_mutation' | WriteRefusal | 'dataset_full' | 'invalid_sql' | 'contended'; detail?: string };

export async function runDocumentMutation(
  doc: ArtifactRow,
  name: string,
  values: Record<string, Scalar>,
): Promise<DocumentMutationOutcome> {
  if (doc.format !== 'markup' || !doc.source) return { ok: false, reason: 'unknown_mutation' };
  const parsed = parseJsx(doc.source);
  if (!parsed.ok) return { ok: false, reason: 'unknown_mutation' };
  const { content } = splitHelmet(parsed.nodes);
  const decl = content.mutations.find((m) => m.name === name);
  if (!decl) return { ok: false, reason: 'unknown_mutation' };

  // Resolved by the DOCUMENT's own scope — never the link-readable fallback,
  // which exists for reads. An unresolvable target reads as read-only, which
  // is what it is from here.
  const writer = writerFor(doc);
  const dataset = await getArtifactFor(writer, decl.target);
  if (!dataset) return { ok: false, reason: 'dataset_read_only' };
  const refusal = canWriteDataset(dataset, writer);
  if (refusal) return { ok: false, reason: refusal };

  // Declared defaults ⊕ what the caller sent, restricted to declared scalars:
  // the same rule a query run follows, so a value the document never declared
  // cannot reach the statement.
  const flow: Dataflow = { values: content.values, queries: content.queries, mutations: content.mutations };
  const bound = initialValues(flow);
  for (const [k, v] of Object.entries(values)) if (k in bound) bound[k] = v;

  const result = await mutateDataset(dataset, decl.sql, bound);
  if (isMutationRefused(result)) return { ok: false, reason: result.reason, detail: result.detail };
  return { ok: true, dataset: result.row, affected: result.affected, rowCount: result.rowCount };
}

/**
 * The documents in the owner's scope that WRITE this dataset, with the
 * mutations they declare — what the share menu shows beside the toggle, so
 * turning writes off can say what will stop working. Same shape and scope as
 * `findDependents`, narrowed to declared writers.
 */
async function findWritersFor(actor: TokenActor, datasetId: string): Promise<Array<{ id: string; title: string | null; mutations: string[] }>> {
  const dependents = await findDependentsFor(actor, datasetId);
  const out: Array<{ id: string; title: string | null; mutations: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    const parsed = parseJsx(dep.source);
    if (!parsed.ok) continue;
    const names = splitHelmet(parsed.nodes).content.mutations.filter((m) => m.target === datasetId).map((m) => m.name);
    if (names.length) out.push({ id: dep.id, title: dep.title, mutations: names });
  }
  return out;
}

/** markup artifacts in scope whose meta.refs include `refId`. */
async function findDependentsScoped(scope: Scope, refId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const res = await db.query(
    `SELECT * FROM artifacts WHERE ${scope.where('$1')} AND format = 'markup' AND meta::text LIKE $2`,
    [scope.val, `%"${refId}"%`],
  );
  const rows = res.rows as unknown as ArtifactRow[]; // meta arrives parsed (JSONB)
  return rows.filter((r) => {
    const refs = (r.meta as { refs?: Array<{ id: string }> }).refs ?? [];
    return refs.some((x) => x.id === refId);
  });
}

export function findDependentsFor(actor: TokenActor, refId: string): Promise<ArtifactRow[]> {
  return findDependentsScoped(ownerScope(actor), refId);
}

/**
 * After a dataset/viz refresh: re-run reference validation for every dependent
 * against the NEW content. Warnings, never blocks: a data refresh
 * can't be stopped by a stale chart.
 */
export async function refreshWarningsFor(actor: TokenActor, updated: ArtifactRow): Promise<Array<{ id: string; title: string | null; details: string[] }>> {
  if (updated.format !== 'dataset' && updated.format !== 'viz') return [];
  const dependents = await findDependentsFor(actor, updated.id);
  if (dependents.length === 0) return [];
  const base = refLoaderForActor(actor);
  const load: RefLoader = async (id) => (id === updated.id ? rowToResolvedRef(updated) : base(id));
  const warnings: Array<{ id: string; title: string | null; details: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    // The SAME checks the publish door runs (refs, SQL dry run, chart bindings
    // against query columns) — so "which dependents broke" is answered by the
    // rule that admitted them.
    const checked = await checkDocumentData(dep.source, load);
    if (!checked.ok) warnings.push({ id: dep.id, title: dep.title, details: checked.details });
  }
  return warnings;
}

/**
 * The document's dataflow at render (or on a re-query): the `<Value>`/`<Query>`
 * declarations of `row.source`, run over the datasets its SQL names — each
 * resolved by the SAME ownership rule as refDataForRow (the doc's token, then
 * the owning account), so a query can read exactly what a `ref:` could and
 * nothing else. Returns null for a document that declares nothing.
 *
 * `values` overrides the declared defaults (a reader's current selections);
 * `only` restricts the run to those queries (the re-query path).
 */
export async function dataflowForRow(
  row: ArtifactRow,
  opts: DataflowRunOptions = {},
): Promise<RanDataflow | null> {
  if (!row.source) return null;
  return runDocumentDataflow(row.source, datasetResolverForRow(row), opts);
}

/**
 * The document's declarations, WITHOUT running anything — the reader's path.
 *
 * Same answer as dataflowForRow minus the expensive half: no dataset is
 * loaded, no SQL is executed, nothing is inlined. The document is served at
 * once and fetches its own rows through the transport its island already
 * names. On a production dashboard this was the difference between a ~100ms
 * render and an ~8ms one, and 231 KB of a 365 KB page.
 */
export function declarationsForRow(row: ArtifactRow): StoryIslandDataflow | null {
  if (!row.source) return null;
  const flow = declarationsOf(row.source);
  return flow ? { flow } : null;
}

export interface DataflowRunOptions {
  values?: Record<string, Scalar>;
  only?: Iterable<string>;
  /** A window of one query (a table reading past the cap). */
  page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } };
}

/** Resolve a dataset id to its row, or null — the ownership rule of the caller. */
export type DatasetResolver = (id: string) => Promise<ArtifactRow | null>;

/** A document's own scope: the token that published it, its owning account, then
 * anything link-readable — render-time must resolve whatever the publish door
 * admitted (getLinkReadableArtifact), or an accepted ref serves broken. */
const datasetResolverForRow = (row: ArtifactRow): DatasetResolver => async (id) =>
  (await getArtifact(row.token_id, id))
  ?? (row.user_id ? await getArtifactByUser(row.user_id, id) : null)
  ?? (await getLinkReadableArtifact(id));

/** A bearer/session actor's scope — the editor running a DRAFT's queries. */
export const datasetResolverForActor = (actor: TokenActor): DatasetResolver => async (id) =>
  (await getArtifactFor(actor, id)) ?? (await getLinkReadableArtifact(id));

/**
 * What a document DECLARES: its `<Value>`s, `<Query>`s and `<Mutation>`s, from
 * the source alone. Null when it declares nothing.
 *
 * Mutations ride along so the runtime can offer them (a `<Button run>` needs
 * the name and its params); they are never RUN here — a write happens on
 * demand, through /a/<id>/mutate, never at render.
 */
export function declarationsOf(source: string): Dataflow | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { content } = splitHelmet(parsed.nodes);
  const flow: Dataflow = { values: content.values, queries: content.queries, ...(content.mutations.length ? { mutations: content.mutations } : {}) };
  return isEmptyDataflow(flow) ? null : flow;
}

/**
 * Run the `<Value>`/`<Query>` declarations of any markup SOURCE (stored or a
 * draft) over the datasets `resolve` admits. Null when it declares nothing;
 * a dataset that does not resolve reads as a missing table in that query.
 */
export async function runDocumentDataflow(
  source: string,
  resolve: DatasetResolver,
  opts: DataflowRunOptions = {},
): Promise<RanDataflow | null> {
  const flow = declarationsOf(source);
  if (!flow) return null;

  const datasets: DatasetTables = {};
  for (const id of datasetRefsInDataflow(flow)) {
    const r = await resolve(id);
    if (!r || r.format !== 'dataset') continue; // unresolvable → the query reports the missing table
    const m = r.meta as { columns?: DatasetColumn[] };
    try {
      datasets[id] = { rows: await loadDatasetRows(r), columns: m.columns ?? [] };
    } catch { /* the query reports the missing table */ }
  }
  const state = await runDataflow(flow, datasets, { values: opts.values, only: opts.only, page: opts.page });
  return { flow, state };
}

/**
 * The dataset ids a document's DATA depends on — everything its queries read
 * plus everything its mutations write. What the live stream subscribes to, so
 * a write anywhere in that set wakes this document's readers
 * (app/a/[id]/events). Derived from the source on every read, because an edit
 * can change what a document reads.
 */
export function datasetsForDocument(source: string | null | undefined): string[] {
  if (!source) return [];
  const parsed = parseJsx(source);
  if (!parsed.ok) return [];
  const { content } = splitHelmet(parsed.nodes);
  const flow: Dataflow = { values: content.values, queries: content.queries, mutations: content.mutations };
  return [...new Set([...datasetRefsInDataflow(flow), ...mutationTargets(flow)])];
}


/** Build the render-time RefDataMap for a jsx artifact: recipes → parsed
 * template, images → their /a URL. (Datasets: see dataflowForRow.) */
export async function refDataForRow(
  row: ArtifactRow,
  opts: { capture?: boolean } = {},
): Promise<import('@/lib/story/ref-data').RefDataMap> {
  const meta = row.meta as { refs?: Array<{ id: string; kind: string }> };
  const out: import('@/lib/story/ref-data').RefDataMap = {};
  // A dataset a <Query> reads is a ref (ownership, dependents) but NOT page
  // data: its rows go through the engine (dataflowForRow) and only the query's
  // RESULT reaches the document.
  for (const ref of meta.refs ?? []) {
    if (ref.kind === 'dataset') continue;
    // Resolve by the doc's token first, then — for a user-owned doc — by the
    // account, then anything link-readable. A signed-in human's docs and their
    // pasted images can sit under DIFFERENT tokens of the same user (the doc on
    // a claimed agent token, the image on the account's 'web' token), and the
    // widened publish door admits any public/unlisted asset besides — whatever
    // it admitted, this must resolve, or the accepted image renders broken.
    const r = (await getArtifact(row.token_id, ref.id))
      ?? (row.user_id ? await getArtifactByUser(row.user_id, ref.id) : null)
      ?? (await getLinkReadableArtifact(ref.id));
    if (!r) continue; // deleted ref → the embed degrades to its fallback
    if (r.format === 'viz') {
      try { out[r.id] = { kind: 'viz', recipe: JSON.parse(r.content) }; } catch { /* skip */ }
    } else if (r.format === 'image') {
      // `/raw` is the BYTES; `/a/<id>` is the HTML page, which an <img> loads
      // to 0×0. The interpreter renders <img src={url}>, so this must be raw.
      // `?v=<version>` makes the URL change when the bytes do, so /raw can serve
      // it immutable and readers stop refetching the image on every render.
      // The intrinsic box, when the store recorded one (lib/images/optimise):
      // the markup reserves it so nothing below jumps when the bytes land.
      const im = r.meta as {
        width?: unknown; height?: unknown; placeholder?: unknown; smallObjectKey?: unknown; smallWidth?: unknown;
      } | null;
      const box = typeof im?.width === 'number' && typeof im?.height === 'number'
        ? { width: im.width, height: im.height }
        : {};
      // The blur the reader sees while the bytes travel. A `data:` URL, which
      // the document's own CSP already admits (img-src 'self' data: blob:).
      const blur = typeof im?.placeholder === 'string' && im.placeholder.startsWith('data:')
        ? { blur: im.placeholder }
        : {};
      /*
       * The narrow copy publish stored beside it, addressed on the same
       * artifact — the second half of the `srcset` the markup writes. Never for
       * a CAPTURE, which wants the full copy and nothing to choose from.
       */
      const widths = !opts.capture && typeof im?.smallWidth === 'number' && typeof im?.smallObjectKey === 'string'
        ? { smallUrl: imageVariantUrl(r.id, r.version, im.smallWidth), smallWidth: im.smallWidth }
        : {};
      out[r.id] = { kind: 'image', url: imageRawUrl(r.id, r.version), ...box, ...blur, ...widths };
    } else if (r.format === 'pdf') {
      // What the CARD says: where the file is, what it is called, how big it is
      // and how long. The name is the artifact's title (the author's, or the
      // one the importer derived from the URL), never the object key.
      const pm = r.meta as { bytes?: unknown; pages?: unknown } | null;
      out[r.id] = {
        kind: 'pdf',
        url: pdfRawUrl(r.id, r.version),
        name: displayTitle(r),
        bytes: typeof pm?.bytes === 'number' ? pm.bytes : 0,
        ...(typeof pm?.pages === 'number' ? { pages: pm.pages } : {}),
      };
    }
  }
  return out;
}
