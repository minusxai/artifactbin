/**
 * App-owned, resumable source-identity backfill contract.
 *
 * The admin runtime passes the process's cached Db. This module must never call
 * getDb itself or open a PGLite instance. One invocation owns one bounded batch;
 * the operator repeats it until `done`.
 */
import { parseJsx, type JsxElement, type JsxNode } from './jsx';
import { commitNormalizedMarkup, publishMarkupForArtifact, type ArtifactRow } from './artifacts';
import type { Db, Queryable } from './db';
import { stampNodeIds } from './story/node-ids';

export const NODE_IDENTITY_MIGRATION = 'source-node-ids';
export const NODE_IDENTITY_MIGRATION_VERSION = 1;

export interface NodeIdentityMigrationOptions {
  /** Integer in [1, 100]. */
  batchSize: number;
  /** Per-artifact bound; exceeding it reports a conflict without partial work. */
  maxHistoricalVersionsPerArtifact?: number;
  dryRun?: boolean;
  /** Test-only deterministic source-id seam. */
  mint?: () => string;
  /** Test-only rollback barrier, after artifact writes but before cursor update/commit. */
  failBeforeCommit?: () => void;
}

export interface NodeIdentityMigrationConflict {
  artifactId: string;
  reason: 'ambiguous_legacy_key' | 'history_limit';
}

export interface NodeIdentityMigrationReport {
  name: typeof NODE_IDENTITY_MIGRATION;
  version: typeof NODE_IDENTITY_MIGRATION_VERSION;
  cursor: string | null;
  processed: number;
  changed: number;
  reserved: number;
  aliases: number;
  conflicts: NodeIdentityMigrationConflict[];
  done: boolean;
  dryRun: boolean;
}

/**
 * Lock order is migration job row, then artifact rows by ascending id. For each
 * artifact, current source, annotations, aliases, reservations, archive/edit
 * history, and cursor advancement commit together. Historical version bytes are
 * only inputs to reservation discovery; they are normalized when restored, not
 * rewritten by this job.
 */
export async function runNodeIdentityMigrationBatch(
  db: Db,
  options: NodeIdentityMigrationOptions,
): Promise<NodeIdentityMigrationReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) {
    throw new Error('node-identity-migration: batchSize must be an integer from 1 through 100');
  }
  const historyCap = options.maxHistoricalVersionsPerArtifact ?? 1000;
  if (!Number.isInteger(historyCap) || historyCap < 0) throw new Error('node-identity-migration: maxHistoricalVersionsPerArtifact must be a non-negative integer');

  const initialJob = await db.query<{ version: number; cursor: string | null; completed_at: string | null }>(
    'SELECT version,cursor,completed_at FROM node_identity_migration_jobs WHERE name=$1', [NODE_IDENTITY_MIGRATION],
  );
  if (initialJob.rows[0]?.version !== undefined && initialJob.rows[0].version !== NODE_IDENTITY_MIGRATION_VERSION) {
    throw new Error(`node-identity-migration: unsupported stored version ${initialJob.rows[0].version}`);
  }
  let cursor = initialJob.rows[0]?.cursor ?? null;
  if (initialJob.rows[0]?.completed_at) return report(cursor, 0, 0, 0, 0, [], true, !!options.dryRun);
  let processed = 0, changed = 0, reserved = 0, aliases = 0;
  let contentionRetries = 0;
  const conflicts: NodeIdentityMigrationConflict[] = [];

  while (processed < options.batchSize) {
    const next = await db.query<ArtifactRow>(
      "SELECT * FROM artifacts WHERE format='markup' AND id > COALESCE($1,'') ORDER BY id LIMIT 1", [cursor],
    );
    const current = next.rows[0];
    if (!current) break;
    const prepared = await prepareArtifact(db, current, historyCap, options);
    if ('conflict' in prepared) { conflicts.push(prepared.conflict!); break; }
    if (options.dryRun) {
      processed++; changed += Number(prepared.changed); reserved += prepared.reserveCount;
      aliases += prepared.aliases.length; cursor = current.id; continue;
    }
    const committed = await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO node_identity_migration_jobs (name,version,cursor) VALUES ($1,$2,NULL) ON CONFLICT (name) DO NOTHING`,
        [NODE_IDENTITY_MIGRATION, NODE_IDENTITY_MIGRATION_VERSION],
      );
      const job = (await tx.query<{ version: number; cursor: string | null; completed_at: string | null }>(
        'SELECT version,cursor,completed_at FROM node_identity_migration_jobs WHERE name=$1 FOR UPDATE', [NODE_IDENTITY_MIGRATION],
      )).rows[0];
      if (job.version !== NODE_IDENTITY_MIGRATION_VERSION) throw new Error(`node-identity-migration: unsupported stored version ${job.version}`);
      if (job.cursor !== cursor || job.completed_at) return false;
      const locked = (await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 FOR UPDATE', [current.id])).rows[0];
      if (!locked || locked.edit_id !== current.edit_id || locked.source !== current.source) return false;
      let insertedCount = 0;
      for (const [id, firstVersion] of prepared.missingReservations) {
        insertedCount += (await tx.query(
          `INSERT INTO artifact_source_ids (artifact_id,source_id,provenance,first_version)
           VALUES ($1,$2,'historical',$3) ON CONFLICT DO NOTHING`, [current.id, id, firstVersion],
        )).rowCount;
      }
      if (prepared.changed) await commitNormalizedMarkup(tx, null, locked, { ...prepared.published!, aliases: prepared.aliases });
      options.failBeforeCommit?.();
      const more = (await tx.query("SELECT 1 FROM artifacts WHERE format='markup' AND id>$1 LIMIT 1", [current.id])).rows.length > 0;
      await tx.query(
        `UPDATE node_identity_migration_jobs SET cursor=$2,completed_at=${more ? 'NULL' : 'now()'},updated_at=now() WHERE name=$1`,
        [NODE_IDENTITY_MIGRATION, current.id],
      );
      return { insertedCount, done: !more };
    });
    if (!committed) {
      if (++contentionRetries >= 3) throw new Error('node-identity-migration: concurrent cursor/head changes exceeded retry limit');
      const live = await db.query<{ cursor: string | null; completed_at: string | null }>('SELECT cursor,completed_at FROM node_identity_migration_jobs WHERE name=$1', [NODE_IDENTITY_MIGRATION]);
      cursor = live.rows[0]?.cursor ?? null;
      if (live.rows[0]?.completed_at) return report(cursor, processed, changed, reserved, aliases, conflicts, true, false);
      continue;
    }
    contentionRetries = 0;
    processed++; changed += Number(prepared.changed);
    reserved += committed.insertedCount + prepared.newCurrentIds;
    aliases += prepared.aliases.length; cursor = current.id;
    if (committed.done) return report(cursor, processed, changed, reserved, aliases, conflicts, true, false);
  }
  const more = conflicts.length > 0 || (await db.query("SELECT 1 FROM artifacts WHERE format='markup' AND id>COALESCE($1,'') LIMIT 1", [cursor])).rows.length > 0;
  if (!more && !options.dryRun && processed === 0) {
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO node_identity_migration_jobs (name,version,cursor) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING`,
        [NODE_IDENTITY_MIGRATION, NODE_IDENTITY_MIGRATION_VERSION, cursor]);
      await tx.query('UPDATE node_identity_migration_jobs SET completed_at=now(),updated_at=now() WHERE name=$1 AND version=$2 AND cursor IS NOT DISTINCT FROM $3',
        [NODE_IDENTITY_MIGRATION, NODE_IDENTITY_MIGRATION_VERSION, cursor]);
    });
  }
  return report(cursor, processed, changed, reserved, aliases, conflicts, !more, !!options.dryRun);
}

async function prepareArtifact(db: Queryable, current: ArtifactRow, historyCap: number, options: NodeIdentityMigrationOptions) {
  const facts = identityFacts(current.source ?? '');
  if ([...facts.legacyCounts.values()].some((count) => count > 1)) {
    return { conflict: { artifactId: current.id, reason: 'ambiguous_legacy_key' } as NodeIdentityMigrationConflict };
  }
  const history = await db.query<{ version: number; source: string | null }>(
    'SELECT version,source FROM artifact_versions WHERE artifact_id=$1 ORDER BY version LIMIT $2', [current.id, historyCap + 1],
  );
  if (history.rows.length > historyCap) return { conflict: { artifactId: current.id, reason: 'history_limit' } as NodeIdentityMigrationConflict };
  const existing = await db.query<{ source_id: string }>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1', [current.id]);
  const versions = new Map<string, number>();
  for (const id of facts.sourceIds) versions.set(id, current.version);
  for (const row of history.rows) for (const id of identityFacts(row.source ?? '').sourceIds) {
    versions.set(id, Math.min(versions.get(id) ?? row.version, row.version));
  }
  const annotations = await db.query<{ anchor_key: string | null; anchor_version: number | null }>(
    'SELECT anchor_key,anchor_version FROM annotations WHERE artifact_id=$1 AND anchor_key IS NOT NULL', [current.id],
  );
  for (const row of annotations.rows) if (row.anchor_key && !facts.aliasOnlyKeys.has(row.anchor_key)) {
    const version = row.anchor_version ?? 1;
    versions.set(row.anchor_key, Math.min(versions.get(row.anchor_key) ?? version, version));
  }
  const prior = new Set(existing.rows.map((row) => row.source_id));
  const identity = stampNodeIds(current.source ?? '', { reservedIds: [...prior, ...versions.keys()], mint: options.mint, retireLegacyAliases: true });
  const missingReservations = [...versions].filter(([id]) => !prior.has(id));
  const changed = identity.source !== (current.source ?? '');
  const published = changed && !options.dryRun ? await publishMarkupForArtifact(current, identity.source) : null;
  if (published instanceof Response) throw new Error(`node-identity-migration: publish refused ${current.id} (${published.status})`);
  return {
    changed, published, aliases: identity.aliases, missingReservations,
    reserveCount: missingReservations.length + identity.ids.filter((id) => !prior.has(id) && !versions.has(id)).length,
    newCurrentIds: identity.ids.filter((id) => !prior.has(id) && !versions.has(id)).length,
  };
}

function report(cursor: string | null, processed: number, changed: number, reserved: number, aliases: number,
  conflicts: NodeIdentityMigrationConflict[], done: boolean, dryRun: boolean): NodeIdentityMigrationReport {
  return { name: NODE_IDENTITY_MIGRATION, version: NODE_IDENTITY_MIGRATION_VERSION, cursor, processed, changed, reserved, aliases, conflicts, done, dryRun };
}

const staticId = (node: JsxElement, name: string): string | null => {
  const value = node.attributes.find((candidate) => candidate.name === name)?.value;
  return value?.static && typeof value.json === 'string' && value.json !== '' && !/[\t\n\f\r ]/.test(value.json) ? value.json : null;
};

function identityFacts(source: string): { sourceIds: Set<string>; aliasOnlyKeys: Set<string>; legacyCounts: Map<string, number> } {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`node-identity-migration: invalid stored JSX: ${parsed.error}`);
  const elements: JsxElement[] = [];
  const visit = (nodes: JsxNode[]) => nodes.forEach((node) => {
    if (node.type !== 'element' || node.tag === 'Helmet') return;
    elements.push(node); visit(node.children);
  });
  visit(parsed.nodes);
  const explicit = new Set(elements.flatMap((node) => staticId(node, 'id') ? [staticId(node, 'id')!] : []));
  const legacyCounts = new Map<string, number>();
  for (const node of elements) {
    const legacy = staticId(node, 'data-annotation-anchor');
    if (legacy) legacyCounts.set(legacy, (legacyCounts.get(legacy) ?? 0) + 1);
  }
  const sourceIds = new Set(explicit);
  const aliasOnlyKeys = new Set<string>();
  for (const node of elements) {
    const id = staticId(node, 'id');
    const legacy = staticId(node, 'data-annotation-anchor');
    if (!legacy) continue;
    if (!id && legacyCounts.get(legacy) === 1 && !explicit.has(legacy)) sourceIds.add(legacy);
    else if (id !== legacy) aliasOnlyKeys.add(legacy);
  }
  return { sourceIds, aliasOnlyKeys, legacyCounts };
}
