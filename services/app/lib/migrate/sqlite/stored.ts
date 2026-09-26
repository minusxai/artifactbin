/**
 * A STORED DOCUMENT, CONVERTED: {@link convertDocument} with its lookups
 * answered from the database — for the one-off migration
 * (lib/sqlite-syntax-migration), and for serving every document the migration
 * has not reached yet ({@link inCurrentSyntax}).
 *
 * A document already in the current data syntax is refused, never converted:
 * the `/` rewrite changes meaning on a second pass (lib/story/data-syntax).
 */
import { catalogOf } from '@/lib/datasets/catalog';
import { getDb, type Queryable } from '@/lib/db';
import { DATA_SYNTAX_META, hasCurrentDataSyntax } from '@/lib/story/data-syntax';
import { convertDocument, type ConvertLookups, type DocumentConversion } from './convert';

export interface StoredDocument {
  source: string;
  meta: Record<string, unknown>;
  /** The owner, whose reach decides whether a referenced title may name the Import. */
  user_id: string | null;
  token_id: string;
}

export type StoredConversion =
  | { status: 'current' }
  | ({ status: 'converted' | 'unchanged' | 'manual' } & DocumentConversion);

interface Referenced {
  id: string;
  format: string;
  title: string | null;
  meta: Record<string, unknown>;
  user_id: string | null;
  token_id: string;
  visibility: string;
}

const kindOf = (row: Referenced | undefined): ReturnType<ConvertLookups['kind']> =>
  row?.format === 'folder' ? 'folder' : row && catalogOf(row)?.kind === 'postgres' ? 'postgres' : 'dataset';

/**
 * The title names the Import only when the document's owner could already
 * read it: their own artifact, or a link-readable one. A private title of
 * someone else's never lands in this document's source.
 */
function importTitle(row: Referenced | undefined, doc: StoredDocument): string | null {
  if (!row) return null;
  const own = doc.user_id ? row.user_id === doc.user_id : row.token_id === doc.token_id;
  return own || row.visibility !== 'private' ? row.title : null;
}

export async function convertStoredDocument(db: Queryable, doc: StoredDocument): Promise<StoredConversion> {
  if (hasCurrentDataSyntax(doc.meta)) return { status: 'current' };
  // The converter asks about the datasets it meets synchronously. A first pass
  // records every one it could ask about (answering "a stored dataset" asks
  // the most), one query answers them all, and the second pass is the conversion.
  const asked = new Set<string>();
  convertDocument(doc.source, { importName: (ref) => void asked.add(ref), kind: (ref) => (asked.add(ref), 'dataset') });
  const rows = asked.size
    ? (await db.query<Referenced>('SELECT id,format,title,meta,user_id,token_id,visibility FROM artifacts WHERE id=ANY($1::text[])', [[...asked]])).rows
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lookups: ConvertLookups = {
    importName: (ref) => importTitle(byId.get(ref), doc),
    kind: (ref) => kindOf(byId.get(ref)),
  };
  const result = convertDocument(doc.source, lookups);
  return { status: result.manual.length ? 'manual' : result.source === doc.source ? 'unchanged' : 'converted', ...result };
}

/** What serving a document at one version reads. */
export interface ServedDocument extends Omit<StoredDocument, 'source'> {
  source: string | null;
  id: string;
  version: number;
  /** The stored graph, which is the stored bytes': a converted document is served without it. */
  document?: unknown;
  /** Set on a document the converter cannot carry over without a person. */
  previousEngine?: true;
}

const CONVERTED = 512;
const converted = new Map<string, { source: string; served: Promise<Partial<ServedDocument>> }>();

/**
 * A DOCUMENT AS THE CURRENT ENGINE SERVES IT — a head or an archived version.
 * Deploys come before the migration runs, so a document without the marker is
 * converted here, on the fly, by the migration's own converter; its stored
 * bytes change only when the migration, or an edit
 * (lib/sqlite-syntax-migration convertArtifactNow), commits the conversion. A
 * conversion that needs a person comes back flagged `previousEngine`, its
 * source as stored. Marked documents pass through untouched, so calling this
 * twice converts once.
 *
 * Cached by artifact and version: conversion is deterministic and a version's
 * bytes do not change (the source is compared all the same).
 */
export async function inCurrentSyntax<T extends ServedDocument>(doc: T): Promise<T> {
  if (doc.previousEngine || hasCurrentDataSyntax(doc.meta)) return doc;
  const source = doc.source ?? '';
  const key = `${doc.id}@${doc.version}`;
  let hit = converted.get(key);
  if (hit?.source !== source) {
    const served = (async (): Promise<Partial<ServedDocument>> => {
      const conversion = await convertStoredDocument(await getDb(), { ...doc, source });
      if (conversion.status === 'current') return {};
      if (conversion.status === 'manual') return { previousEngine: true };
      return { source: conversion.source, meta: { ...doc.meta, ...DATA_SYNTAX_META }, document: null };
    })();
    hit = { source, served };
    converted.delete(key);
    converted.set(key, hit);
    if (converted.size > CONVERTED) converted.delete(converted.keys().next().value!);
    served.catch(() => converted.delete(key));
  }
  return { ...doc, ...(await hit.served) };
}
