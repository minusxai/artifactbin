import {artifactQuery,sourceStorage} from '../artifact-document';
/** Pure planning plus transactional execution for the legacy dataset catalog cutover. */
import { createHash } from 'node:crypto';
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import type { DatasetCatalog } from './types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Db } from '@/lib/db';
import { ARTIFACT_ID_PATTERN, ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts';
import { removedSqlReferenceTokens } from '@/lib/migrate/sqlite/legacy-tokens';
import { newEditId } from '@/lib/story/splice';
import { finalizeArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';
import { catalogFromMetadata } from './catalog-metadata';

interface MigrationDiagnostic { artifactId?: string; version?: number; reason: string }
interface SourceMigration { source: string; changed: boolean; diagnostics: MigrationDiagnostic[] }

type LegacyMeta = Record<string, unknown> & { objectKey?: string; columns?: DatasetColumn[]; catalog?: DatasetCatalog };

export function catalogMetadata(meta: LegacyMeta): LegacyMeta {
  if (meta.catalog) return meta;
  const catalog=catalogFromMetadata(meta);
  return catalog ? { ...meta, catalog } : meta;
}


function rewriteSql(sql: string, names: Map<string, string>, single: boolean, excluded=new Set<string>()): { sql: string; ids: string[]; diagnostic?: string } {
  const scanned = removedSqlReferenceTokens(sql);
  if (scanned.diagnostic) return { sql, ids: [], diagnostic: scanned.diagnostic };
  const tokens=scanned.tokens.filter(token=>!excluded.has(token.id));
  const ids = [...new Set(tokens.map((token) => token.id))];
  let out = sql;
  for (const token of tokens.toReversed()) {
    const plain = single ? (token.qualified ? 'rows' : 'public.rows') : names.get(token.id)!;
    const replacement = token.quoted ? plain.split('.').map((part)=>`"${part}"`).join('.') : plain;
    out = out.slice(0, token.start) + replacement + out.slice(token.end);
  }
  return { sql: out, ids };
}

const attr = (el: JsxElement, name: string): string | null => {
  const value = el.attributes.find((a) => a.name === name)?.value;
  return value?.static && typeof value.json === 'string' ? value.json : null;
};

interface MarkupMigrationOptions { folderIds?: Set<string>; knownTargetIds?: Set<string> }
export function migrateMarkupSource(source: string,options:MarkupMigrationOptions={}): SourceMigration {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { source, changed: false, diagnostics: [{ reason: `invalid JSX: ${parsed.error}` }] };
  const declarations: JsxElement[] = [];
  const names = new Set<string>();
  let helmetStart: number | null = null;
  const visit = (nodes: JsxNode[]) => nodes.forEach((node) => {
    if (node.type !== 'element') return;
    if (node.tag === 'Helmet') helmetStart = node.start;
    if (node.tag === 'Value' || node.tag === 'Query' || node.tag === 'Mutation') { const name = attr(node, 'name'); if (name) names.add(name); }
    if (node.tag === 'Query' || node.tag === 'Mutation') declarations.push(node);
    visit(node.children);
  });
  visit(parsed.nodes);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const upstream = new Map<string, string>();
  const diagnostics: MigrationDiagnostic[] = [];
  const upstreamName = (id: string) => {
    let candidate = `source_${id}`; let suffix = 2;
    while (names.has(candidate)) candidate = `source_${id}_${suffix++}`;
    names.add(candidate); upstream.set(id, candidate); return candidate;
  };
  for (const el of declarations) {
    const explicit = attr(el, 'source');
    if (explicit) {
      const id = ARTIFACT_REFERENCE_PATTERN.exec(explicit)?.[1] ?? (ARTIFACT_ID_PATTERN.test(explicit) ? explicit : null);
      if (!id || (options.knownTargetIds && !options.knownTargetIds.has(id))) {
        diagnostics.push({reason: `${el.tag} ${attr(el, 'name') ?? '?'} references unavailable source ${explicit}`});
      } else if (explicit === id) {
        const attribute = el.attributes.find(a => a.name === 'source')!;
        edits.push({start: attribute.start, end: attribute.end, text: `source="ref:${id}"`});
      }
      const expression=el.children.find(child=>child.type==='expression');
      if(expression?.value.static&&typeof expression.value.json==='string'){
        const segment=source.slice(expression.start,expression.end),first=segment.indexOf('`'),last=segment.lastIndexOf('`');
        const sql=first>=0&&last>first?segment.slice(first+1,last):expression.value.json;
        const scanned=removedSqlReferenceTokens(sql);
        if(scanned.diagnostic)diagnostics.push({reason:`${el.tag} ${attr(el,'name')??'?'}: ${scanned.diagnostic}`});
        else if(scanned.tokens.some(token=>token.id!==id))diagnostics.push({reason:`${el.tag} ${attr(el,'name')??'?'} has SQL references that disagree with its explicit source`});
        else if(scanned.tokens.length){
          if(first<0||last<=first)diagnostics.push({reason:`${el.tag} ${attr(el,'name')??'?'} SQL span unavailable`});
          else edits.push({start:expression.start+first+1,end:expression.start+last,text:rewriteSql(sql,new Map(),true).sql});
        }
      }
      continue;
    }
    const expression = el.children.find((child) => child.type === 'expression');
    if (!expression || !expression.value.static || typeof expression.value.json !== 'string') continue;
    const segment = source.slice(expression.start, expression.end);
    const first = segment.indexOf('`'), last = segment.lastIndexOf('`');
    if (first < 0 || last <= first) { diagnostics.push({ reason: `${el.tag} ${attr(el, 'name') ?? '?'} SQL span unavailable` }); continue; }
    const rawSql = segment.slice(first + 1, last);
    const scanned = removedSqlReferenceTokens(rawSql);
    if (scanned.diagnostic) { diagnostics.push({ reason: `${el.tag} ${attr(el, 'name') ?? '?'}: ${scanned.diagnostic}` }); continue; }
    const allIds=[...new Set(scanned.tokens.map((token)=>token.id))];
    const unknown=options.knownTargetIds&&allIds.find(id=>!options.knownTargetIds!.has(id));
    if(unknown){diagnostics.push({reason:`${el.tag} ${attr(el,'name')??'?'} references unavailable source ${unknown}`});continue;}
    const ids = allIds;
    if (!ids.length) continue;
    if (el.tag === 'Mutation' && ids.length !== 1) { diagnostics.push({ reason: `Mutation ${attr(el, 'name') ?? '?'} has ${ids.length} legacy sources` }); continue; }
    // Legacy reads executed in the document engine. Moving their computation
    // into the catalog compiler changes the dialect, even for a single source.
    // Only mutations move directly to the authorized dataset write boundary.
    const direct = el.tag === 'Mutation';
    if (!direct) for (const id of ids) if (!upstream.has(id)) upstreamName(id);
    const rewritten = rewriteSql(rawSql, upstream, direct).sql;
    edits.push({ start: expression.start + first + 1, end: expression.start + last, text: rewritten });
    if (direct) {
      const openEnd = source.indexOf('>', el.start);
      edits.push({ start: openEnd, end: openEnd, text: ` source="ref:${ids[0]}"` });
    }
  }
  if (upstream.size) {
    if (helmetStart === null) return { source, changed: false, diagnostics: [{ reason: 'multi-source query has no Helmet' }] };
    const openEnd = source.indexOf('>', helmetStart) + 1;
    const injected = [...upstream].map(([id, name]) => `<Query name="${name}" source="ref:${id}">{\`select * from public.rows\`}</Query>`).join('');
    edits.push({ start: openEnd, end: openEnd, text: injected });
  }
  if (diagnostics.length) return { source, changed: false, diagnostics };
  let migrated = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) migrated = migrated.slice(0, edit.start) + edit.text + migrated.slice(edit.end);
  return { source: migrated, changed: migrated !== source, diagnostics: [] };
}

interface DatasetMigrationOptions { after?: string; expected?: Record<string,string>; batchSize: number; dryRun?: boolean; maxHistoricalVersionsPerArtifact?: number; validate?: (source: string, artifact: Record<string, unknown>, version?: number) => Promise<string[]>; beforeCommit?: (artifactId: string) => void | Promise<void>; failBeforeCommit?: () => void }
interface MigrationSnapshot { head: Record<string,unknown>; history: Record<string,unknown>[] }
interface DatasetMigrationPlan { artifactId: string; fingerprint: string; before: MigrationSnapshot; after: MigrationSnapshot }
const fingerprint = (snapshot: MigrationSnapshot): string => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
interface HistoricalException { artifactId: string; version: number; reason: string }
interface DatasetMigrationReport { plans: DatasetMigrationPlan[]; nextCursor: string | null; processed: number; changed: number; datasets: number; documents: number; versions: number; conflicts: MigrationDiagnostic[]; historicalExceptions: HistoricalException[]; done: boolean; dryRun: boolean }

function planRecord(row:Record<string,unknown>,markupOptions:MarkupMigrationOptions) {
  const meta=row.format==='dataset'?catalogMetadata((row.meta??{}) as LegacyMeta):row.meta;
  const source=row.format==='markup'?migrateMarkupSource(String(row.source??''),markupOptions):{
    source:row.source as string|null,changed:false,diagnostics:[] as MigrationDiagnostic[],
  };
  if(row.format==='dataset'&&!catalogFromMetadata(row.meta))source.diagnostics.push({reason:'Dataset has no catalog or stored object key'});
  return {meta,source};
}

/** The same classification drives preview, apply and audit. Exceptions preserve
 * the entire original version, and are recomputed rather than persisted as a
 * permanent validation bypass. Infrastructure errors still propagate. */
async function planSnapshot(before:MigrationSnapshot,markupOptions:MarkupMigrationOptions,options:DatasetMigrationOptions) {
  const row=before.head,artifactId=String(row.id);
  const {meta:plannedMeta,source:plannedSource}=planRecord(row,markupOptions);
  const overLimit=before.history.length>(options.maxHistoricalVersionsPerArtifact??1000);
  const plannedHistory=overLimit?[]:before.history.map(version=>({version,...planRecord(version,markupOptions)}));
  const headChanged=plannedSource.changed||plannedMeta!==row.meta;
  const conflicts=plannedSource.diagnostics.map(d=>({...d,artifactId}));
  const historicalExceptions:HistoricalException[]=[];
  const historyChanged:typeof plannedHistory=[];
  if(overLimit)conflicts.push({artifactId,reason:'history_limit'});
  if(!conflicts.length){
    for(const entry of plannedHistory){
      const changed=entry.meta!==entry.version.meta||entry.source.changed;
      const reasons=entry.source.diagnostics.map(d=>d.reason);
      if(!reasons.length&&changed&&entry.version.format==='markup'&&options.validate)
        reasons.push(...await options.validate(String(entry.source.source??''),row,Number(entry.version.version)));
      if(reasons.length)historicalExceptions.push({artifactId,version:Number(entry.version.version),reason:reasons.join('; ')});
      else if(changed)historyChanged.push(entry);
    }
    // A historical exception must not bypass validation of the live head,
    // including when that head itself requires no textual migration.
    if(row.format==='markup'&&options.validate&&(headChanged||historyChanged.length||historicalExceptions.length)){
      const errors=await options.validate(String(plannedSource.source??''),row);
      if(errors.length)conflicts.push({artifactId,reason:errors.join('; ')});
    }
  }
  return {plannedMeta,plannedSource,plannedHistory,headChanged,historyChanged,conflicts,historicalExceptions};
}

export async function runDatasetCatalogMigrationBatch(db: Db, options: DatasetMigrationOptions): Promise<DatasetMigrationReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('dataset-catalog-migration: batchSize must be an integer from 1 through 100');
  const dryRun=options.dryRun ?? true;
  const targets=await db.query<{id:string;format:string}>('SELECT id,format FROM artifacts');
  const knownTargetIds=new Set(targets.rows.filter(row=>row.format==='dataset'||row.format==='folder').map(row=>row.id));
  const folderIds=new Set(targets.rows.filter(row=>row.format==='folder').map(row=>row.id));
  const markupOptions={knownTargetIds,folderIds};
  const candidates = await artifactQuery<Record<string, unknown>>(db,options.expected ? 'SELECT * FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id' : `SELECT * FROM artifacts a WHERE (
    (format='dataset' AND (meta->'catalog' IS NULL OR meta->'catalog'='null'::jsonb)) OR format='markup' OR EXISTS (
      SELECT 1 FROM artifact_versions v WHERE v.artifact_id=a.id AND ((v.format='dataset' AND (v.meta->'catalog' IS NULL OR v.meta->'catalog'='null'::jsonb)) OR v.format='markup')
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
    const planned=await planSnapshot(before,markupOptions,options);
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
    (format='dataset' AND (meta->'catalog' IS NULL OR meta->'catalog'='null'::jsonb)) OR format='markup' OR EXISTS (
      SELECT 1 FROM artifact_versions v WHERE v.artifact_id=a.id AND ((v.format='dataset' AND (v.meta->'catalog' IS NULL OR v.meta->'catalog'='null'::jsonb)) OR v.format='markup')
    ))`);
  let hasRemaining=false;
  for(const row of remaining.rows){
    const history=await artifactQuery<Record<string,unknown>>(db,'SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version',[row.id]);
    const planned=await planSnapshot({head:row,history:history.rows},markupOptions,options);
    if(planned.conflicts.length||planned.headChanged||planned.historyChanged.length){hasRemaining=true;break;}
  }
  return { plans, nextCursor, processed, changed, datasets, documents, versions, conflicts, historicalExceptions, done: !hasRemaining, dryRun };
}
