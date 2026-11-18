/**
 * THE DRAFT STORE. A draft is the reader's own page, assembled once (lib/document-serving nativeDraftDocument) with the
 * tables its linked CSV or JSON files are, and the files it links, kept in this process's memory: keyed by reader and
 * content, never written to the database, bounded per reader (DRAFT_LIMITS: past a cap the reader's least recently
 * shown draft is forgotten) and forgotten `ttlSeconds` after it, or a file it links, was last asked for. Re-sending the same content is the same draft at the same origin, with a fresh ticket.
 *
 * Its origin is `draft-<label>.<pages host>`; the label is an HMAC of reader and content under a key drawn when the
 * process starts, so it cannot be guessed, differs per reader, and names nothing after a restart. The document is
 * released only for a one-time ticket (`_pt`, spent once, `ticketSeconds`); the files it links are served by path for
 * the draft's life, read-only, to whoever holds the label: the page's own browser.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { fileContentType } from '@artifactbin/contracts';
import { inferColumns } from '@artifactbin/utils/shape';
import { planPublicationBundle } from '@/lib/html-publication-bundle';
import { coerceRows, parseCsv } from '@/lib/data-ingest';
import { nativeDraftDocument, type NativeDraftRender } from '@/lib/document-serving';
import { DRAFT_LIMITS, type DraftConnection, type DraftInput, type DraftRefusalCode } from './contracts';

export class DraftRefusal extends Error {
  constructor(readonly code: DraftRefusalCode, message: string, readonly status = code === 'draft_limit' ? 429 : 400) { super(message); this.name = 'DraftRefusal'; }
}

interface Draft {
  label: string;
  reader: string;
  html: string;
  files: Map<string, { bytes: Buffer; contentType: string }>;
  entryPath: string;
  /** Its `default:` links, and whether the embedding app allowed them to read live. */
  connections: DraftConnection[];
  liveSql: boolean;
  bytes: number;
  expires: number;
  tickets: Map<string, number>;
}
const drafts = new Map<string, Draft>();
const KEY = randomBytes(32);
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const base32 = (bytes: Buffer): string => { let bits = 0, value = 0, out = ''; for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; } } return out; };

/** For tests: forget every draft. */
export function resetDrafts(): void { drafts.clear(); }

function sweep(now: number): void { for (const [label, draft] of drafts) if (draft.expires <= now) drafts.delete(label); }

function ticketFor(draft: Draft, now: number): string {
  for (const [ticket, expires] of draft.tickets) if (expires <= now) draft.tickets.delete(ticket);
  const ticket = randomBytes(24).toString('base64url');
  draft.tickets.set(ticket, now + DRAFT_LIMITS.ticketSeconds * 1000);
  return ticket;
}

const decoded = (base64: unknown, name: string): Buffer => {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new DraftRefusal('invalid_draft', `${name} is not base64`);
  return Buffer.from(base64, 'base64');
};

/** Checks the shape and every limit before anything is planned or parsed. */
function admitted(input: unknown): { html: string; entryPath: string; liveSql: boolean; files: Array<{ path: string; bytes: Buffer; contentType: string }> } {
  const body = input as Partial<DraftInput> | null;
  if (!body || typeof body.html !== 'string' || !Array.isArray(body.files)) throw new DraftRefusal('invalid_draft', 'a draft is {html, files: [{path, base64}]}');
  const entryPath = body.entryPath ?? 'index.html';
  if (typeof entryPath !== 'string' || !/\.html?$/i.test(entryPath)) throw new DraftRefusal('invalid_draft', 'entryPath names the page\'s own .html path');
  if (Buffer.byteLength(body.html) > DRAFT_LIMITS.htmlBytes) throw new DraftRefusal('draft_too_large', `the page is over ${DRAFT_LIMITS.htmlBytes} bytes`);
  if (body.liveSql !== undefined && typeof body.liveSql !== 'boolean') throw new DraftRefusal('invalid_draft', 'liveSql is true or false');
  if (body.files.length > DRAFT_LIMITS.files) throw new DraftRefusal('draft_too_large', `a draft links at most ${DRAFT_LIMITS.files} files`);
  let total = Buffer.byteLength(body.html);
  const files = body.files.map((file) => {
    if (!file || typeof file.path !== 'string' || !file.path) throw new DraftRefusal('invalid_draft', 'each file is {path, base64}');
    const bytes = decoded(file.base64, file.path);
    if (bytes.byteLength > DRAFT_LIMITS.fileBytes) throw new DraftRefusal('draft_too_large', `${file.path} is over ${DRAFT_LIMITS.fileBytes} bytes`);
    total += bytes.byteLength;
    const contentType = typeof file.contentType === 'string' && file.contentType ? file.contentType : fileContentType(file.path) ?? 'application/octet-stream';
    return { path: file.path, bytes, contentType };
  });
  if (total > DRAFT_LIMITS.totalBytes) throw new DraftRefusal('draft_too_large', `the page and its files are over ${DRAFT_LIMITS.totalBytes} bytes`);
  return { html: body.html, entryPath, liveSql: body.liveSql === true, files };
}

const DEFAULT_NAMESPACE = /^(?:[A-Za-z0-9_][A-Za-z0-9_$.:/-]{0,127})?$/;
/**
 * `<link rel="af-dataset" data-af-name=NAME href=PATH>`: each linked file's dataset name, by its resolved path; and
 * each `href="default:DB"` link, the install's default connection, checked as publish checks it.
 */
function datasetNames(html: string, entryPath: string): { names: Map<string, string>; connections: DraftConnection[] } {
  const names = new Map<string, string>(), connections: DraftConnection[] = [];
  const visit = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node && node.tagName === 'link') {
      const attr = (name: string) => node.attrs.find((a) => a.name === name)?.value;
      const href = attr('href'), name = attr('data-af-name');
      const fallback = /^default:(.*)$/s.exec(href ?? '');
      if ((attr('rel') ?? '').split(/\s+/).includes('af-dataset') && name && fallback) {
        if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name) || !DEFAULT_NAMESPACE.test(fallback[1]!)) throw new DraftRefusal('invalid_draft', `the link ${name} is href="default:DB": a name of letters, digits and _, and a database of letters, digits and _ $ . : / -`);
        if (connections.length < 20) connections.push({ kind: 'default-connection', name, namespace: fallback[1]! });
      } else if ((attr('rel') ?? '').split(/\s+/).includes('af-dataset') && href && name && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) {
        try { names.set(path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), decodeURIComponent(href.split(/[?#]/)[0]!))), name); } catch { /* the plan refuses it */ }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(parse(html));
  return { names, connections };
}

/** A linked CSV or JSON file as the read-only table `name` (schema `main`, a stable `_id` first, as a dataset's), naming
 * its file so a read of it says where its rows came from (contracts sql-source `file`). */
function tableOf(name: string, file: string, bytes: Buffer): NativeDraftRender['tables'][number] {
  let records: Record<string, unknown>[];
  if (/\.json$/i.test(file)) {
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new DraftRefusal('invalid_draft_csv', `${file} is not JSON`); }
    if (!Array.isArray(parsed) || !parsed.every((row) => row && typeof row === 'object' && !Array.isArray(row))) throw new DraftRefusal('invalid_draft_csv', `${file} is not a JSON array of row objects`);
    records = parsed as Record<string, unknown>[];
  } else {
    const { headers, rows, quotedEmptyCells } = parseCsv(bytes.toString('utf8'));
    if (!headers.length || !rows.length) throw new DraftRefusal('invalid_draft_csv', `${file} has no data rows under its header`);
    if (rows.length > DRAFT_LIMITS.rows) throw new DraftRefusal('draft_too_large', `${file} has ${rows.length} rows; a draft's table holds at most ${DRAFT_LIMITS.rows}`);
    records = coerceRows(headers, rows, [], quotedEmptyCells);
  }
  if (records.length > DRAFT_LIMITS.rows) throw new DraftRefusal('draft_too_large', `${file} has ${records.length} rows; a draft's table holds at most ${DRAFT_LIMITS.rows}`);
  const columns = inferColumns(records).filter((column) => column.name !== '_id').map((column) => ({ name: column.name, type: column.type }));
  if (columns.length > DRAFT_LIMITS.columns) throw new DraftRefusal('draft_too_large', `${file} has ${columns.length} columns; a draft's table holds at most ${DRAFT_LIMITS.columns}`);
  return { schema: 'main', name, file, columns: [{ name: '_id', type: 'string' }, ...columns], rows: records.map((row, i) => ({ _id: String(i + 1), ...row })) };
}

/** The draft of `reader`'s page and files, made or found, with a fresh ticket for its document. */
export async function createDraft(reader: string, input: unknown, appOrigin: string, now = Date.now()): Promise<{ label: string; ticket: string; entryPath: string; connections: string[]; liveSql: boolean }> {
  sweep(now);
  const draft = admitted(input);
  const digest = createHash('sha256').update(JSON.stringify([draft.liveSql, draft.entryPath, draft.html, draft.files.map((file) => [file.path, file.contentType, createHash('sha256').update(file.bytes).digest('hex')]).sort()])).digest();
  const label = `draft-${base32(createHmac('sha256', KEY).update(reader).update('\0').update(digest).digest()).slice(0, 26)}`;
  const held = drafts.get(label);
  if (held && held.reader === reader) { held.expires = now + DRAFT_LIMITS.ttlSeconds * 1000; return { label, ticket: ticketFor(held, now), entryPath: held.entryPath, connections: held.connections.map((c) => c.name), liveSql: held.liveSql }; }
  let plan;
  try { plan = planPublicationBundle(draft.html, { entryPath: draft.entryPath, files: draft.files.map((file) => ({ path: file.path, contentType: file.contentType, base64: file.bytes.toString('base64') })) }, { filesServedByPath: true }); }
  catch (cause) { throw new DraftRefusal('unresolved_draft_files', cause instanceof Error ? cause.message : 'the page links files the draft does not carry'); }
  const { names, connections } = datasetNames(draft.html, plan.entryPath);
  const files = new Map<string, { bytes: Buffer; contentType: string }>();
  const tables: NativeDraftRender['tables'][number][] = [];
  let bytes = Buffer.byteLength(draft.html);
  for (const dependency of plan.dependencies) {
    const content = Buffer.from(dependency.bytes);
    files.set(dependency.path, { bytes: content, contentType: dependency.contentType });
    bytes += content.byteLength;
    const name = names.get(dependency.path);
    if (dependency.kind === 'dataset' && name) tables.push(tableOf(name, dependency.path, content));
  }
  const html = await nativeDraftDocument({ label, html: draft.html, appOrigin, datasets: tables.map((table) => table.name), tables, connections: connections.map((c) => c.name), liveSql: draft.liveSql });
  // What is held is the assembled page (its tables inside) and the files: that is what the reader's caps count.
  const size = bytes + Buffer.byteLength(html);
  if (size > DRAFT_LIMITS.readerBytes) throw new DraftRefusal('draft_limit', `this draft holds ${size} bytes once assembled; a reader's drafts hold at most ${DRAFT_LIMITS.readerBytes}`);
  // At a cap, the reader's least recently shown drafts are forgotten first (a frame still showing one asks for it again).
  const mine = [...drafts.values()].filter((other) => other.reader === reader).sort((a, b) => a.expires - b.expires);
  let total = mine.reduce((sum, other) => sum + other.bytes, 0);
  while (mine.length && (mine.length >= DRAFT_LIMITS.perReader || total + size > DRAFT_LIMITS.readerBytes)) { const oldest = mine.shift()!; total -= oldest.bytes; drafts.delete(oldest.label); }
  const made: Draft = { label, reader, html, files, entryPath: plan.entryPath, connections, liveSql: draft.liveSql, bytes: size, expires: now + DRAFT_LIMITS.ttlSeconds * 1000, tickets: new Map() };
  drafts.set(label, made);
  return { label, ticket: ticketFor(made, now), entryPath: made.entryPath, connections: connections.map((c) => c.name), liveSql: draft.liveSql };
}

/** The draft's document for a ticket minted for it, spent here; null for any other ticket, a spent one or a gone draft. */
export function draftDocument(label: string, ticket: string | null, now = Date.now()): string | null {
  sweep(now);
  const draft = drafts.get(label);
  const expires = ticket ? draft?.tickets.get(ticket) : undefined;
  if (!draft || !ticket || expires === undefined) return null;
  draft.tickets.delete(ticket);
  return expires > now ? draft.html : null;
}

/** A file the draft links, by its path; null otherwise. */
export function draftFile(label: string, pathname: string, now = Date.now()): { bytes: Buffer; contentType: string } | null {
  sweep(now);
  const draft = drafts.get(label);
  if (!draft) return null;
  let wanted: string;
  try { wanted = decodeURIComponent(pathname.replace(/^\//, '')); } catch { return null; }
  const file = draft.files.get(wanted);
  // A page still reading its files keeps its draft.
  if (file) draft.expires = now + DRAFT_LIMITS.ttlSeconds * 1000;
  return file ?? null;
}

/** Forget draft `label` now (a check's own draft, once it was looked at). */
export function forgetDraft(label: string): void { drafts.delete(label); }

/** Whether `reader`'s own draft `label` exists and its embedding app has not allowed live reads (yet). */
export function draftAwaitsConsent(reader: string, label: string, now = Date.now()): boolean {
  sweep(now);
  const draft = drafts.get(label);
  return !!draft && draft.reader === reader && !draft.liveSql;
}

/**
 * The default-connection links `reader`'s own draft `label` may read live, or null: no such draft, another reader's,
 * or one whose embedding app did not allow live reads. Asking keeps the draft.
 */
export function draftConnections(reader: string, label: string, now = Date.now()): DraftConnection[] | null {
  sweep(now);
  const draft = drafts.get(label);
  if (!draft || draft.reader !== reader || !draft.liveSql) return null;
  draft.expires = now + DRAFT_LIMITS.ttlSeconds * 1000;
  return draft.connections;
}
