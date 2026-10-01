import { editorScope, ownerScope, type ArtifactRow, type DatasetAccess, type Scope, type TokenActor, type Visibility } from './access';
import { getArtifactFor, writeShares } from './store';
import { findWritersFor } from './dataflow';
import { artifactQuery } from './document';
import { grantsOf } from '../datasets/policy/grants';
import { catalogOf } from '@/lib/datasets/catalog';
import { getDb } from '../platform/db';
import { actorSubject, emit } from '../platform/events';
import { type ShareEntry, type ShareRole } from './share-roles';

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
  const r = await artifactQuery<ArtifactRow>(db,
    `UPDATE artifacts SET access = $3 WHERE id = $1 AND ${scope.where('$2')} AND format = 'dataset' AND ($3 <> 'readwrite' OR COALESCE(meta->'catalog'->>'kind','stored') <> 'postgres') RETURNING *, pg_notify('artifact_' || lower(id), edit_id)`,
    [id, scope.val, access],
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
  datasetKind?: 'stored' | 'postgres';
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
  /** False for an anonymous owner: `private` has no ACL to anchor without an account. */
  canPrivate?: boolean;
}

/**
 * Editor-access read of an artifact's ACL. Null = unknown/foreign (uniform 404).
 *
 * Scoped by ACTOR, not by account: an ANONYMOUS owner has an ACL to manage
 * too, now that `access` lives here — writes anchor on the creating token, not
 * on an account. (`private` still needs one, and `canPrivate` says so, which
 * is what keeps the UI from offering a tier the door would refuse.)
 */
export async function getSharingFor(actor: TokenActor, id: string): Promise<SharingState | null> {
  const db = await getDb();
  const row = await getArtifactFor(actor, id);
  if (!row) return null;
  const shares = await db.query<ShareEntry>(
    'SELECT email, role FROM artifact_shares WHERE artifact_id = $1 ORDER BY email',
    [id],
  );
  return {
    visibility: row.visibility,
    linkRole: (row.link_role ?? 'viewer') as ShareRole,
    shares: shares.rows,
    canPrivate: !!row.user_id,
    ...(row.format === 'dataset'
      ? { access: row.access, policyVersion:grantsOf(row)?2:1, datasetKind: catalogOf(row)?.kind ?? 'stored', writtenBy: await findWritersFor(actor, id) }
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
 * Editor-access update of an artifact's ACL. `shares` is FULL-REPLACE (the UI
 * always sends the whole list — idempotent, no add/remove protocol). Emails
 * are normalized to lowercase and collapsed — the LAST role given for an
 * address wins; the route validates shape and role names upstream.
 */
export async function updateSharingFor(actor: TokenActor, id: string, patch: SharingPatch): Promise<SharingState | null> {
  const db = await getDb();
  const scope = editorScope(actor);
  const done = await db.transaction(async (tx) => {
    const owned = await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')} FOR UPDATE`, [id, scope.val]);
    if (owned.rows.length === 0) return false;
    if (patch.visibility) {
      await tx.query(`UPDATE artifacts SET visibility = $2 WHERE id = $1 `, [id, patch.visibility]);
    }
    if (patch.linkRole) {
      await tx.query(`UPDATE artifacts SET link_role = $2 WHERE id = $1 `, [id, patch.linkRole]);
    }
    if (patch.access) {
      // Datasets only — the SQL says so rather than the caller, so a document
      // can never acquire a write ACL by way of this surface.
      await tx.query(`UPDATE artifacts SET access = $2 WHERE id = $1  AND format = 'dataset' AND ($2 <> 'readwrite' OR COALESCE(meta->'catalog'->>'kind','stored') <> 'postgres')`, [id, patch.access]);
    }
    if(patch.shares!==undefined)await writeShares(tx,id,patch.shares);
    // Dataset subscribers must re-read capabilities even when rows/version
    // have not changed. The existing data wakeup already refreshes queries.
    await tx.query(`SELECT pg_notify('artifact_' || lower(id), edit_id) FROM artifacts WHERE id = $1`, [id]);
    const row = owned.rows[0];
    const shares = await tx.query<ShareEntry>('SELECT email, role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id]);
    return {
      visibility: patch.visibility ?? row.visibility,
      linkRole: patch.linkRole ?? row.link_role ?? 'viewer',
      shares: shares.rows,
      canPrivate: !!row.user_id,
      ...(row.format === 'dataset' ? {access:patch.access ?? row.access,datasetKind:catalogOf(row)?.kind ?? 'stored'} : {}),
    } satisfies SharingState;
  });
  if (!done) return null;
  /*
   * AFTER the transaction, and only when the ACL actually moved. The payload
   * carries the two axes a change can name and nothing else: the share list is
   * email addresses, which never travel to the log — an operator reading
   * "sharing_changed" learns the tier, not who is on it.
   */
  await emit(actorSubject(actor), 'sharing_changed', { kind: 'artifact', id }, {
    visibility: patch.visibility ?? null,
    link_role: patch.linkRole ?? null,
  });
  return (await getSharingFor(actor, id)) ?? done;
}


export async function updateSharing(userId: string, id: string, patch: SharingPatch): Promise<SharingState | null> {
  return updateSharingFor({ tokenId: '', userId }, id, patch);
}
