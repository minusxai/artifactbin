/**
 * ONE-TIME DATA REWRITE, run with the boot backfills (./db applyBackfills): a dataset's stored source
 * was static `<Dataset kind="stored"><Table … /></Dataset>` markup and is now canonical JSON
 * (@artifactbin/utils/dataset-definition). Every head and archived version still holding markup is
 * rewritten in place; nothing else on the row moves (version, edit_id, meta). Idempotent: a rewritten
 * row no longer matches, and a second run finds nothing.
 *
 * The markup is read HERE ONLY, and only as the app's serializer always wrote it: `<Tag attr=… >`,
 * `<Tag attr=… />` and `</Tag>`, each value a double-quoted string with `& < > "` as entities or a
 * `{JSON}` literal. A source this reader does not recognise (sections of retired dataset kinds, a
 * malformed value) is rebuilt from the row's own catalog (`meta.catalog`), which holds every table,
 * its columns and its SQL; its rows are in the object store either way. A row with neither is left
 * as it is, never failing the boot.
 */
import { formatDatasetDefinition, type DatasetDefinitionShape } from '@artifactbin/utils/dataset-definition';
import type { Queryable } from './db';

type Element = { tag: string; close: boolean; selfClosing: boolean; attrs: Record<string, unknown> };
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/** The end of the JSON literal opening at `start` (a `{`), or -1. */
function literalEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start, quoted = false; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return i;
  }
  return -1;
}

function readElements(source: string): Element[] | null {
  const elements: Element[] = [];
  const at = /\s*<(\/?)([A-Za-z]+)/y, attr = /\s*([A-Za-z]+)=/y, end = /\s*(\/?)>/y, text = /"([^"]*)"/y;
  let i = 0;
  while (i < source.length && source.slice(i).trim()) {
    at.lastIndex = i; const open = at.exec(source); if (!open) return null;
    const element: Element = { tag: open[2]!, close: open[1] === '/', selfClosing: false, attrs: {} };
    i = at.lastIndex;
    for (;;) {
      end.lastIndex = i; const closing = end.exec(source);
      if (closing) { element.selfClosing = closing[1] === '/'; i = end.lastIndex; break; }
      attr.lastIndex = i; const name = attr.exec(source); if (!name || element.close) return null;
      i = attr.lastIndex;
      if (source[i] === '{') {
        const last = literalEnd(source, i); if (last < 0) return null;
        try { element.attrs[name[1]!] = JSON.parse(source.slice(i + 1, last)); } catch { return null; }
        i = last + 1;
      } else {
        text.lastIndex = i; const value = text.exec(source); if (!value) return null;
        element.attrs[name[1]!] = value[1]!.replace(/&(amp|lt|gt|quot);/g, (_, entity: string) => ENTITY[entity]!);
        i = text.lastIndex;
      }
    }
    elements.push(element);
  }
  return elements;
}

const only = (attrs: Record<string, unknown>, allowed: string[]) => Object.keys(attrs).every(key => allowed.includes(key));

/** The definition the markup states, or null when it is not the stored shape this reader knows. */
function definitionFromMarkup(source: string): DatasetDefinitionShape | null {
  const elements = readElements(source);
  if (!elements || elements.length < 2) return null;
  const root = elements[0]!, last = elements.at(-1)!, tables = elements.slice(1, -1);
  if (root.tag !== 'Dataset' || root.close || root.selfClosing || last.tag !== 'Dataset' || !last.close) return null;
  if (!only(root.attrs, ['kind', 'defaultSchema', 'refreshSeconds']) || root.attrs.kind !== 'stored') return null;
  if (tables.some(t => t.tag !== 'Table' || t.close || !t.selfClosing || !only(t.attrs, ['schema', 'name', 'columns', 'rows', 'sql']))) return null;
  return { ...root.attrs, tables: tables.map(t => t.attrs) } as unknown as DatasetDefinitionShape;
}

type CatalogTable = { schema: string; name: string; columns: unknown[]; sql?: string };
/** A stored catalog (lib/datasets DatasetCatalog) restated as the definition that keeps it. */
function definitionFromCatalog(meta: unknown): DatasetDefinitionShape | null {
  const catalog = (meta as { catalog?: { kind?: unknown; defaultSchema?: string; tables?: CatalogTable[] } } | null)?.catalog;
  if (catalog?.kind !== 'stored' || !Array.isArray(catalog.tables) || !catalog.tables.length) return null;
  return { kind: 'stored', defaultSchema: catalog.defaultSchema, tables: catalog.tables.map(({ schema, name, columns, sql }) => ({ schema, name, columns, ...(sql !== undefined ? { sql } : {}) })) };
}

function datasetDefinitionJson(source: string, meta: unknown): string | null {
  const definition = definitionFromMarkup(source) ?? definitionFromCatalog(meta);
  return definition ? formatDatasetDefinition(definition) : null;
}

const MARKUP = "format = 'dataset' AND ltrim(source) LIKE '<Dataset%'";
const PAGE = 50;

/** Rewrite every dataset head and archived version still stored as markup; returns how many rows changed. */
export async function rewriteDatasetDefinitions(db: Queryable): Promise<number> {
  let changed = 0;
  for (let after = ''; ;) {
    const rows = (await db.query<{ id: string; source: string; meta: unknown }>(`SELECT id, source, meta FROM artifacts WHERE ${MARKUP} AND id > $1 ORDER BY id LIMIT ${PAGE}`, [after])).rows;
    for (const row of rows) {
      const json = datasetDefinitionJson(row.source, row.meta);
      // Guarded on the text it read: a write that landed meanwhile already stored JSON.
      if (json !== null) changed += (await db.query('UPDATE artifacts SET source = $2 WHERE id = $1 AND source = $3', [row.id, json, row.source])).rowCount ?? 0;
    }
    if (rows.length < PAGE) break;
    after = rows.at(-1)!.id;
  }
  for (let after = { id: '', version: 0 }; ;) {
    const rows = (await db.query<{ artifact_id: string; version: number; source: string; meta: unknown }>(`SELECT artifact_id, version, source, meta FROM artifact_versions WHERE ${MARKUP} AND (artifact_id, version) > ($1::text, $2::int) ORDER BY artifact_id, version LIMIT ${PAGE}`, [after.id, after.version])).rows;
    for (const row of rows) {
      const json = datasetDefinitionJson(row.source, row.meta);
      if (json !== null) changed += (await db.query('UPDATE artifact_versions SET source = $3 WHERE artifact_id = $1 AND version = $2 AND source = $4', [row.artifact_id, row.version, json, row.source])).rowCount ?? 0;
    }
    if (rows.length < PAGE) break;
    after = { id: rows.at(-1)!.artifact_id, version: rows.at(-1)!.version };
  }
  return changed;
}
