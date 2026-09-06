/** Pure planning plus transactional execution for the legacy dataset catalog cutover. */
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import type { DatasetCatalog } from './types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Db } from '@/lib/db';
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

interface SqlToken { start: number; end: number; id: string; qualified: boolean; quoted?: boolean }

function legacyTokens(sql: string): { tokens: SqlToken[]; diagnostic?: string } {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") { i++; while (i < sql.length) { if (sql[i] === '\\') i += 2; else if (sql[i] === "'" && sql[i + 1] === "'") i += 2; else if (sql[i++] === "'") break; } if (i > sql.length) return { tokens, diagnostic: 'unterminated SQL string' }; continue; }
    if (c === '"') {
      const start=i++; let value=''; let closed=false;
      while(i<sql.length){if(sql[i]==='"'&&sql[i+1]==='"'){value+='"';i+=2;}else if(sql[i]==='"'){i++;closed=true;break;}else value+=sql[i++];}
      if(!closed)return {tokens,diagnostic:'unterminated quoted SQL identifier'};
      const match=/^ref_([A-Za-z0-9]{6,12})$/.exec(value);
      if(match)tokens.push({start,end:i,id:match[1],qualified:sql[i]==='.',quoted:true});
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') { i = sql.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1; i += 2;
      while (i < sql.length && depth) { if (sql.startsWith('/*', i)) { depth++; i += 2; } else if (sql.startsWith('*/', i)) { depth--; i += 2; } else i++; }
      if (depth) return { tokens, diagnostic: 'unterminated SQL comment' };
      continue;
    }
    if (c === '$') { const opening=/^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i)); if(opening){const end=sql.indexOf(opening[0],i+opening[0].length);if(end<0)return {tokens,diagnostic:'unterminated dollar-quoted SQL string'};i=end+opening[0].length;continue;} }
    if ((i === 0 || !/[\w$]/.test(sql[i - 1])) && sql.startsWith('ref_', i)) {
      const match = /^ref_([A-Za-z0-9]{6,12})\b/.exec(sql.slice(i));
      if (match) { const end = i + match[0].length; tokens.push({ start: i, end, id: match[1], qualified: sql[end] === '.' }); i = end; continue; }
    }
    i++;
  }
  return { tokens };
}

function rewriteSql(sql: string, names: Map<string, string>, single: boolean): { sql: string; ids: string[]; diagnostic?: string } {
  const scanned = legacyTokens(sql);
  if (scanned.diagnostic) return { sql, ids: [], diagnostic: scanned.diagnostic };
  const ids = [...new Set(scanned.tokens.map((token) => token.id))];
  let out = sql;
  for (const token of scanned.tokens.toReversed()) {
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

export function migrateMarkupSource(source: string): SourceMigration {
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
    if (attr(el, 'source')) continue;
    const expression = el.children.find((child) => child.type === 'expression');
    if (!expression || !expression.value.static || typeof expression.value.json !== 'string') continue;
    const segment = source.slice(expression.start, expression.end);
    const first = segment.indexOf('`'), last = segment.lastIndexOf('`');
    if (first < 0 || last <= first) { diagnostics.push({ reason: `${el.tag} ${attr(el, 'name') ?? '?'} SQL span unavailable` }); continue; }
    const rawSql = segment.slice(first + 1, last);
    const scanned = legacyTokens(rawSql);
    if (scanned.diagnostic) { diagnostics.push({ reason: `${el.tag} ${attr(el, 'name') ?? '?'}: ${scanned.diagnostic}` }); continue; }
    const ids = [...new Set(scanned.tokens.map((token) => token.id))];
    if (!ids.length) continue;
    if (el.tag === 'Mutation' && ids.length !== 1) { diagnostics.push({ reason: `Mutation ${attr(el, 'name') ?? '?'} has ${ids.length} legacy sources` }); continue; }
    const localDeps = el.tag === 'Query' ? queryDeps(expression.value.json, names).filter((name)=>name!==attr(el,'name')) : [];
    const direct = ids.length === 1 && (el.tag === 'Mutation' || localDeps.length === 0);
    if (!direct) for (const id of ids) if (!upstream.has(id)) upstreamName(id);
    const rewritten = rewriteSql(rawSql, upstream, direct).sql;
    edits.push({ start: expression.start + first + 1, end: expression.start + last, text: rewritten });
    if (direct) {
      const openEnd = source.indexOf('>', el.start);
      edits.push({ start: openEnd, end: openEnd, text: ` source="${ids[0]}"` });
    }
  }
  if (upstream.size) {
    if (helmetStart === null) return { source, changed: false, diagnostics: [{ reason: 'multi-source query has no Helmet' }] };
    const openEnd = source.indexOf('>', helmetStart) + 1;
    const injected = [...upstream].map(([id, name]) => `<Query name="${name}" source="${id}">{\`select * from public.rows\`}</Query>`).join('');
    edits.push({ start: openEnd, end: openEnd, text: injected });
  }
  if (diagnostics.length) return { source, changed: false, diagnostics };
  let migrated = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) migrated = migrated.slice(0, edit.start) + edit.text + migrated.slice(edit.end);
  return { source: migrated, changed: migrated !== source, diagnostics: [] };
}

export interface DatasetMigrationOptions { batchSize: number; dryRun?: boolean; maxHistoricalVersionsPerArtifact?: number; validate?: (source: string, artifact: Record<string, unknown>, version?: number) => Promise<string[]>; beforeCommit?: (artifactId: string) => void | Promise<void>; failBeforeCommit?: () => void }
export interface DatasetMigrationReport { processed: number; changed: number; datasets: number; documents: number; versions: number; conflicts: MigrationDiagnostic[]; done: boolean; dryRun: boolean }

export async function runDatasetCatalogMigrationBatch(db: Db, options: DatasetMigrationOptions): Promise<DatasetMigrationReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('dataset-catalog-migration: batchSize must be an integer from 1 through 100');
  const historyLimit = options.maxHistoricalVersionsPerArtifact ?? 1000;
  const candidates = await db.query<Record<string, unknown>>(`SELECT * FROM artifacts WHERE deleted_at IS NULL AND ((format='dataset' AND NOT (meta ? 'catalog')) OR (format='markup' AND source LIKE '%ref\_%')) ORDER BY id LIMIT $1`, [options.batchSize]);
  let changed = 0, datasets = 0, documents = 0, versions = 0;
  const conflicts: MigrationDiagnostic[] = [];
  for (const row of candidates.rows) {
    const artifactId = String(row.id); const format = String(row.format); const editId = String(row.edit_id ?? '');
    const plannedMeta = format === 'dataset' ? catalogMetadata((row.meta ?? {}) as LegacyMeta) : row.meta;
    const plannedSource = format === 'markup' ? migrateMarkupSource(String(row.source ?? '')) : { source: row.source as string | null, changed: false, diagnostics: [] };
    if (plannedSource.diagnostics.length) { conflicts.push(...plannedSource.diagnostics.map((d) => ({ ...d, artifactId }))); continue; }
    const history = await db.query<Record<string, unknown>>('SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version', [artifactId]);
    if (history.rows.length > historyLimit) { conflicts.push({ artifactId, reason: 'history_limit' }); continue; }
    const plannedHistory = history.rows.map((version) => ({ version, meta: format === 'dataset' ? catalogMetadata((version.meta ?? {}) as LegacyMeta) : version.meta,
      source: format === 'markup' ? migrateMarkupSource(String(version.source ?? '')) : { source: version.source as string | null, changed: false, diagnostics: [] } }));
    const bad = plannedHistory.find((entry) => 'diagnostics' in entry.source && entry.source.diagnostics.length);
    if (bad) { conflicts.push({ artifactId, version: Number(bad.version.version), reason: bad.source.diagnostics[0].reason }); continue; }
    const headChanged = plannedSource.changed || plannedMeta !== row.meta;
    const historyChanged = plannedHistory.filter((entry) => entry.meta !== entry.version.meta || ('changed' in entry.source && entry.source.changed));
    if (!headChanged && !historyChanged.length) continue;
    if (format === 'markup' && options.validate) {
      const headErrors = await options.validate(String(plannedSource.source ?? ''), row);
      if (headErrors.length) { conflicts.push({artifactId,reason:headErrors.join('; ')}); continue; }
      let rejected=false;
      for(const entry of historyChanged){const source='source' in entry.source?entry.source.source:entry.source;if(typeof source!=='string')continue;const errors=await options.validate(source,row,Number(entry.version.version));if(errors.length){conflicts.push({artifactId,version:Number(entry.version.version),reason:errors.join('; ')});rejected=true;break;}}
      if(rejected)continue;
    }
    changed++; if (format === 'dataset') datasets++; else documents++; versions += historyChanged.length;
    if (options.dryRun) continue;
    await options.beforeCommit?.(artifactId);
    const committed = await db.transaction(async (tx) => {
      const locked = (await tx.query<Record<string, unknown>>('SELECT edit_id,source,meta FROM artifacts WHERE id=$1 FOR UPDATE', [artifactId])).rows[0];
      if (!locked || String(locked.edit_id ?? '') !== editId || locked.source !== row.source || JSON.stringify(locked.meta) !== JSON.stringify(row.meta)) return false;
      for (const entry of historyChanged) await tx.query('UPDATE artifact_versions SET meta=$3::jsonb,source=$4 WHERE artifact_id=$1 AND version=$2', [artifactId, entry.version.version, JSON.stringify(entry.meta), 'source' in entry.source ? entry.source.source : entry.source]);
      await tx.query('UPDATE artifacts SET meta=$2::jsonb,source=$3 WHERE id=$1', [artifactId, JSON.stringify(plannedMeta), plannedSource.source]);
      options.failBeforeCommit?.(); return true;
    });
    if (!committed) { changed--; if (format === 'dataset') datasets--; else documents--; versions -= historyChanged.length; conflicts.push({ artifactId, reason: 'concurrent_change' }); }
  }
  const remaining = await db.query<Record<string, unknown>>(`SELECT format,meta,source FROM artifacts WHERE deleted_at IS NULL AND ((format='dataset' AND NOT (meta ? 'catalog')) OR (format='markup' AND source LIKE '%ref\_%'))`);
  const hasRemaining = remaining.rows.some((row) => row.format === 'dataset'
    ? catalogMetadata((row.meta ?? {}) as LegacyMeta) !== row.meta
    : migrateMarkupSource(String(row.source ?? '')).changed || migrateMarkupSource(String(row.source ?? '')).diagnostics.length > 0);
  return { processed: candidates.rows.length, changed, datasets, documents, versions, conflicts, done: !hasRemaining, dryRun: !!options.dryRun };
}
