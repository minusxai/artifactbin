import {artifactQuery,sourceStorage} from '../artifact-document';
/**
 * Pure planning plus transactional execution for the legacy dataset catalog
 * cutover: a stored dataset's metadata gains its catalog, live and retained.
 * DOCUMENTS are not this migration's: it used to rewrite `ref_<id>` tables to
 * `source=`/`public.rows`, a syntax the compiler now refuses, so every
 * markup version is left byte-identical for the SQLite syntax migration
 * (lib/migrate/sqlite/convert.ts reads `ref_<id>` directly).
 */
import { createHash } from 'node:crypto';
import type { DatasetCatalog } from './types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Db } from '@/lib/db';
import { newEditId } from '@/lib/story/splice';
import { finalizeArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';
import { catalogFromMetadata } from './catalog-metadata';

interface MigrationDiagnostic { artifactId?: string; version?: number; reason: string }

type LegacyMeta = Record<string, unknown> & { objectKey?: string; columns?: DatasetColumn[]; catalog?: DatasetCatalog };

export function catalogMetadata(meta: LegacyMeta): LegacyMeta {
  if (meta.catalog) return meta;
  const catalog=catalogFromMetadata(meta);
  return catalog ? { ...meta, catalog } : meta;
}



interface DatasetMigrationOptions { after?: string; expected?: Record<string,string>; batchSize: number; dryRun?: boolean; maxHistoricalVersionsPerArtifact?: number; beforeCommit?: (artifactId: string) => void | Promise<void>; failBeforeCommit?: () => void }
interface MigrationSnapshot { head: Record<string,unknown>; history: Record<string,unknown>[] }
interface DatasetMigrationPlan { artifactId: string; fingerprint: string; before: MigrationSnapshot; after: MigrationSnapshot }
const fingerprint = (snapshot: MigrationSnapshot): string => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
interface HistoricalException { artifactId: string; version: number; reason: string }
interface DatasetMigrationReport { plans: DatasetMigrationPlan[]; nextCursor: string | null; processed: number; changed: number; datasets: number; documents: number; versions: number; conflicts: MigrationDiagnostic[]; historicalExceptions: HistoricalException[]; done: boolean; dryRun: boolean }

function planRecord(row:Record<string,unknown>) {
  const meta=row.format==='dataset'?catalogMetadata((row.meta??{}) as LegacyMeta):row.meta;
  const source={source:row.source as string|null,changed:false,diagnostics:[] as MigrationDiagnostic[]};
  if(row.format==='dataset'&&!catalogFromMetadata(row.meta))source.diagnostics.push({reason:'Dataset has no catalog or stored object key'});
  return {meta,source};
}

/** The same classification drives preview, apply and audit. Exceptions preserve
 * the entire original version, and are recomputed rather than persisted as a
 * permanent validation bypass. Infrastructure errors still propagate. */
async function planSnapshot(before:MigrationSnapshot,options:DatasetMigrationOptions) {
  const row=before.head,artifactId=String(row.id);
  const {meta:plannedMeta,source:plannedSource}=planRecord(row);
  const overLimit=before.history.length>(options.maxHistoricalVersionsPerArtifact??1000);
  const plannedHistory=overLimit?[]:before.history.map(version=>({version,...planRecord(version)}));
  const headChanged=plannedSource.changed||plannedMeta!==row.meta;
  const conflicts=plannedSource.diagnostics.map(d=>({...d,artifactId}));
  const historicalExceptions:HistoricalException[]=[];
  const historyChanged:typeof plannedHistory=[];
  if(overLimit)conflicts.push({artifactId,reason:'history_limit'});
  if(!conflicts.length){
    for(const entry of plannedHistory){
      const changed=entry.meta!==entry.version.meta||entry.source.changed;
      const reasons=entry.source.diagnostics.map(d=>d.reason);
      if(reasons.length)historicalExceptions.push({artifactId,version:Number(entry.version.version),reason:reasons.join('; ')});
      else if(changed)historyChanged.push(entry);
    }
  }
  return {plannedMeta,plannedSource,plannedHistory,headChanged,historyChanged,conflicts,historicalExceptions};
}

export async function runDatasetCatalogMigrationBatch(db: Db, options: DatasetMigrationOptions): Promise<DatasetMigrationReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('dataset-catalog-migration: batchSize must be an integer from 1 through 100');
  const dryRun=options.dryRun ?? true;
  const candidates = await artifactQuery<Record<string, unknown>>(db,options.expected ? 'SELECT * FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id' : `SELECT * FROM artifacts a WHERE (
    (format='dataset' AND (meta->'catalog' IS NULL OR meta->'catalog'='null'::jsonb)) OR EXISTS (
      SELECT 1 FROM artifact_versions v WHERE v.artifact_id=a.id AND v.format='dataset' AND (v.meta->'catalog' IS NULL OR v.meta->'catalog'='null'::jsonb)
    )) AND id > $1 ORDER BY id`, [options.expected ? Object.keys(options.expected) : options.after ?? '']);
  let processed=0, changed = 0, datasets = 0, documents = 0, versions = 0;
  const conflicts: MigrationDiagnostic[] = [];
  const historicalExceptions: HistoricalException[] = [];
  const plans: DatasetMigrationPlan[] = [];
  let nextCursor: string | null = null;
  if (options.expected) for (const id of Object.keys(options.expected)) if (!candidates.rows.some(row=>row.id===id)) conflicts.push({artifactId:id,reason:'reviewed_snapshot_changed'});
  for (const row of candidates.rows) {
    if(processed>=options.batchSize){nextCursor=String(candidates.rows[candidates.rows.indexOf(row)-1].id);break;}
    const artifactId = String(row.id); const format = String(row.format);
    const history = await artifactQuery<Record<string, unknown>>(db,'SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version', [artifactId]);
    const before = {head:row,history:history.rows};
    if(options.expected && options.expected[artifactId] !== fingerprint(before)){conflicts.push({artifactId,reason:'reviewed_snapshot_changed'});processed++;continue;}
    const planned=await planSnapshot(before,options);
    const {plannedMeta,plannedSource,plannedHistory,headChanged,historyChanged}=planned;
    const hasWork=headChanged||historyChanged.length>0;
    if(!hasWork&&!planned.conflicts.length&&!planned.historicalExceptions.length)continue;
    processed++;
    historicalExceptions.push(...planned.historicalExceptions);
    if(planned.conflicts.length){conflicts.push(...planned.conflicts);continue;}
    if(!hasWork)continue;
    const after:MigrationSnapshot={
      head:headChanged?{...row,meta:finalizeArtifactMetadata(format,plannedSource.source,plannedMeta as Record<string,unknown>),source:plannedSource.source,edit_id:newEditId()}:row,
      history:plannedHistory.map(entry=>historyChanged.includes(entry)?{...entry.version,meta:finalizeArtifactMetadata(String(entry.version.format),entry.source.source,entry.meta as Record<string,unknown>),source:entry.source.source}:entry.version),
    };
    // The reviewed snapshot includes the same representation stored by the commit.
    for(const record of [...(headChanged?[after.head]:[]),...after.history.filter(version=>historyChanged.some(entry=>entry.version.version===version.version))]){
      const stored=sourceStorage(String(record.format),record.source as string|null);
      record.document=stored.document?JSON.parse(stored.document):null;
    }
    plans.push({artifactId,fingerprint:fingerprint(before),before,after});
    changed++; if (format === 'dataset') datasets++; else documents++; versions += historyChanged.length;
    if (dryRun) continue;
    await options.beforeCommit?.(artifactId);
    const committed = await db.transaction(async (tx) => {
      const locked = (await artifactQuery<Record<string, unknown>>(tx,'SELECT * FROM artifacts WHERE id=$1 FOR UPDATE', [artifactId])).rows[0];
      const lockedHistory=await artifactQuery<Record<string,unknown>>(tx,'SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version FOR UPDATE',[artifactId]);
      if (!locked || fingerprint({head:locked,history:lockedHistory.rows}) !== fingerprint(before)) return false;
      for (const entry of historyChanged) await tx.query('UPDATE artifact_versions SET meta=$3::jsonb,source=CASE WHEN $5::jsonb IS NULL THEN $4::text ELSE NULL END,document=$5::jsonb WHERE artifact_id=$1 AND version=$2', [artifactId, entry.version.version, JSON.stringify(after.history.find(version=>version.version===entry.version.version)!.meta), entry.source.source,sourceStorage(String(entry.version.format),entry.source.source).document]);
      if (headChanged) await tx.query('UPDATE artifacts SET meta=$2::jsonb,source=CASE WHEN $5::jsonb IS NULL THEN $3::text ELSE NULL END,document=$5::jsonb,edit_id=$4 WHERE id=$1', [artifactId, JSON.stringify(after.head.meta), plannedSource.source, after.head.edit_id,sourceStorage(format,plannedSource.source).document]);
      options.failBeforeCommit?.(); return true;
    });
    if (!committed) { changed--; if (format === 'dataset') datasets--; else documents--; versions -= historyChanged.length; conflicts.push({ artifactId, reason: 'concurrent_change' }); }
  }
  const remaining = await artifactQuery<Record<string, unknown>>(db,`SELECT * FROM artifacts a WHERE (
    (format='dataset' AND (meta->'catalog' IS NULL OR meta->'catalog'='null'::jsonb)) OR EXISTS (
      SELECT 1 FROM artifact_versions v WHERE v.artifact_id=a.id AND v.format='dataset' AND (v.meta->'catalog' IS NULL OR v.meta->'catalog'='null'::jsonb)
    ))`);
  let hasRemaining=false;
  for(const row of remaining.rows){
    const history=await artifactQuery<Record<string,unknown>>(db,'SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version',[row.id]);
    const planned=await planSnapshot({head:row,history:history.rows},options);
    if(planned.conflicts.length||planned.headChanged||planned.historyChanged.length){hasRemaining=true;break;}
  }
  return { plans, nextCursor, processed, changed, datasets, documents, versions, conflicts, historicalExceptions, done: !hasRemaining, dryRun };
}
