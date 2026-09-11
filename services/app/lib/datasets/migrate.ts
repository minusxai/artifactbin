/** Pure planning plus transactional execution for the legacy dataset catalog cutover. */
import { createHash } from 'node:crypto';
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import type { DatasetCatalog } from './types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Db } from '@/lib/db';
import { ARTIFACT_ID_PATTERN, ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts';
import { removedSqlReferenceTokens } from '@/lib/story/sql-reference-tokens';
import { newEditId } from '@/lib/story/splice';
import { finalizeArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';
import { queryDeps } from '@/lib/story/dataflow';

export interface MigrationDiagnostic { artifactId?: string; version?: number; reason: string }
export interface SourceMigration { source: string; changed: boolean; diagnostics: MigrationDiagnostic[] }

type LegacyMeta = Record<string, unknown> & { objectKey?: string; columns?: DatasetColumn[]; catalog?: DatasetCatalog };

export function catalogMetadata(meta: LegacyMeta): LegacyMeta {
  if (meta.catalog) return meta;
  if (!meta.objectKey) return meta;
  const catalog: DatasetCatalog = { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
    tables: [{ schema: 'public', name: 'rows', columns: meta.columns ?? [], objectKey: meta.objectKey }] };
  return { ...meta, catalog };
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

export interface MarkupMigrationOptions { folderIds?: Set<string>; knownTargetIds?: Set<string> }
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
    const localDeps = el.tag === 'Query' ? queryDeps(expression.value.json, names).filter((name)=>name!==attr(el,'name')) : [];
    const direct = ids.length === 1 && (el.tag === 'Mutation' || localDeps.length === 0);
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

export interface DatasetMigrationOptions { after?: string; expected?: Record<string,string>; batchSize: number; dryRun?: boolean; maxHistoricalVersionsPerArtifact?: number; validate?: (source: string, artifact: Record<string, unknown>, version?: number) => Promise<string[]>; beforeCommit?: (artifactId: string) => void | Promise<void>; failBeforeCommit?: () => void }
export interface MigrationSnapshot { head: Record<string,unknown>; history: Record<string,unknown>[] }
export interface DatasetMigrationPlan { artifactId: string; fingerprint: string; before: MigrationSnapshot; after: MigrationSnapshot }
const fingerprint = (snapshot: MigrationSnapshot): string => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
export interface DatasetMigrationReport { plans: DatasetMigrationPlan[]; nextCursor: string | null; processed: number; changed: number; datasets: number; documents: number; versions: number; conflicts: MigrationDiagnostic[]; done: boolean; dryRun: boolean }

export async function runDatasetCatalogMigrationBatch(db: Db, options: DatasetMigrationOptions): Promise<DatasetMigrationReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('dataset-catalog-migration: batchSize must be an integer from 1 through 100');
  const historyLimit = options.maxHistoricalVersionsPerArtifact ?? 1000;
  const dryRun=options.dryRun ?? true;
  const targets=await db.query<{id:string;format:string}>('SELECT id,format FROM artifacts');
  const knownTargetIds=new Set(targets.rows.filter(row=>row.format==='dataset'||row.format==='folder').map(row=>row.id));
  const folderIds=new Set(targets.rows.filter(row=>row.format==='folder').map(row=>row.id));
  const markupOptions={knownTargetIds,folderIds};
  const candidates = await db.query<Record<string, unknown>>(options.expected ? 'SELECT * FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id' : `SELECT * FROM artifacts a WHERE (
    (format='dataset' AND NOT (meta ? 'catalog')) OR format='markup' OR EXISTS (
      SELECT 1 FROM artifact_versions v WHERE v.artifact_id=a.id AND ((v.format='dataset' AND NOT (v.meta ? 'catalog')) OR v.format='markup')
    )) AND id > $1 ORDER BY id`, [options.expected ? Object.keys(options.expected) : options.after ?? '']);
  let processed=0, changed = 0, datasets = 0, documents = 0, versions = 0;
  const conflicts: MigrationDiagnostic[] = [];
  const plans: DatasetMigrationPlan[] = [];
  let nextCursor: string | null = null;
  if (options.expected) for (const id of Object.keys(options.expected)) if (!candidates.rows.some(row=>row.id===id)) conflicts.push({artifactId:id,reason:'reviewed_snapshot_changed'});
  for (const row of candidates.rows) {
    if(processed>=options.batchSize){nextCursor=String(candidates.rows[candidates.rows.indexOf(row)-1].id);break;}
    const artifactId = String(row.id); const format = String(row.format);
    const plannedMeta = format === 'dataset' ? catalogMetadata((row.meta ?? {}) as LegacyMeta) : row.meta;
    const plannedSource = format === 'markup' ? migrateMarkupSource(String(row.source ?? ''),markupOptions) : { source: row.source as string | null, changed: false, diagnostics: [] };
    if (plannedSource.diagnostics.length) { conflicts.push(...plannedSource.diagnostics.map((d) => ({ ...d, artifactId }))); continue; }
    const history = await db.query<Record<string, unknown>>('SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version', [artifactId]);
    const before = {head:row,history:history.rows};
    if(options.expected && options.expected[artifactId] !== fingerprint(before)){conflicts.push({artifactId,reason:'reviewed_snapshot_changed'});continue;}
    if (history.rows.length > historyLimit) { conflicts.push({ artifactId, reason: 'history_limit' }); continue; }
    const plannedHistory = history.rows.map((version) => ({ version, meta: version.format === 'dataset' ? catalogMetadata((version.meta ?? {}) as LegacyMeta) : version.meta,
      source: version.format === 'markup' ? migrateMarkupSource(String(version.source ?? ''),markupOptions) : { source: version.source as string | null, changed: false, diagnostics: [] } }));
    const bad = plannedHistory.find((entry) => 'diagnostics' in entry.source && entry.source.diagnostics.length);
    if (bad) { conflicts.push({ artifactId, version: Number(bad.version.version), reason: bad.source.diagnostics[0].reason }); continue; }
    const headChanged = plannedSource.changed || plannedMeta !== row.meta;
    const historyChanged = plannedHistory.filter((entry) => entry.meta !== entry.version.meta || ('changed' in entry.source && entry.source.changed));
    if (!headChanged && !historyChanged.length) continue;
    processed++;
    if (options.validate) {
      const headErrors = format === 'markup' ? await options.validate(String(plannedSource.source ?? ''), row) : [];
      if (headErrors.length) { conflicts.push({artifactId,reason:headErrors.join('; ')}); continue; }
      let rejected=false;
      for(const entry of historyChanged){if(entry.version.format!=='markup')continue;const source='source' in entry.source?entry.source.source:entry.source;if(typeof source!=='string')continue;const errors=await options.validate(source,row,Number(entry.version.version));if(errors.length){conflicts.push({artifactId,version:Number(entry.version.version),reason:errors.join('; ')});rejected=true;break;}}
      if(rejected)continue;
    }
    const after:MigrationSnapshot={
      head:headChanged?{...row,meta:finalizeArtifactMetadata(format,plannedSource.source,plannedMeta as Record<string,unknown>),source:plannedSource.source,edit_id:newEditId()}:row,
      history:plannedHistory.map(entry=>historyChanged.includes(entry)?{...entry.version,meta:finalizeArtifactMetadata(String(entry.version.format),entry.source.source,entry.meta as Record<string,unknown>),source:entry.source.source}:entry.version),
    };
    plans.push({artifactId,fingerprint:fingerprint(before),before,after});
    changed++; if (format === 'dataset') datasets++; else documents++; versions += historyChanged.length;
    if (dryRun) continue;
    await options.beforeCommit?.(artifactId);
    const committed = await db.transaction(async (tx) => {
      const locked = (await tx.query<Record<string, unknown>>('SELECT * FROM artifacts WHERE id=$1 FOR UPDATE', [artifactId])).rows[0];
      const lockedHistory=await tx.query<Record<string,unknown>>('SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version FOR UPDATE',[artifactId]);
      if (!locked || fingerprint({head:locked,history:lockedHistory.rows}) !== fingerprint(before)) return false;
      for (const entry of historyChanged) await tx.query('UPDATE artifact_versions SET meta=$3::jsonb,source=$4 WHERE artifact_id=$1 AND version=$2', [artifactId, entry.version.version, JSON.stringify(after.history.find(version=>version.version===entry.version.version)!.meta), entry.source.source]);
      if (headChanged) await tx.query('UPDATE artifacts SET meta=$2::jsonb,source=$3,edit_id=$4 WHERE id=$1', [artifactId, JSON.stringify(after.head.meta), plannedSource.source, after.head.edit_id]);
      options.failBeforeCommit?.(); return true;
    });
    if (!committed) { changed--; if (format === 'dataset') datasets--; else documents--; versions -= historyChanged.length; conflicts.push({ artifactId, reason: 'concurrent_change' }); }
  }
  const remaining = await db.query<Record<string, unknown>>(`SELECT * FROM artifacts a WHERE (
    (format='dataset' AND NOT (meta ? 'catalog')) OR format='markup' OR EXISTS (
      SELECT 1 FROM artifact_versions v WHERE v.artifact_id=a.id AND ((v.format='dataset' AND NOT (v.meta ? 'catalog')) OR v.format='markup')
    ))`);
  let hasRemaining=false;
  for(const row of remaining.rows){
    const headPlan=row.format==='markup'?migrateMarkupSource(String(row.source??''),markupOptions):null;
    const head=row.format==='dataset'?catalogMetadata((row.meta??{}) as LegacyMeta)!==row.meta:!!headPlan&&(headPlan.changed||headPlan.diagnostics.length>0);
    const history=await db.query<Record<string,unknown>>('SELECT format,meta,source FROM artifact_versions WHERE artifact_id=$1',[row.id]);
    const oldHistory=history.rows.some((version)=>{if(version.format==='dataset')return catalogMetadata((version.meta??{}) as LegacyMeta)!==version.meta;if(version.format!=='markup')return false;const plan=migrateMarkupSource(String(version.source??''),markupOptions);return plan.changed||plan.diagnostics.length>0;});
    if(head||oldHistory){hasRemaining=true;break;}
  }
  return { plans, nextCursor, processed, changed, datasets, documents, versions, conflicts, done: !hasRemaining, dryRun };
}
