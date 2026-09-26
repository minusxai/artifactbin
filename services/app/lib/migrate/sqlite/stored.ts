/**
 * A STORED DOCUMENT, CONVERTED: {@link convertDocument} with its lookups
 * answered from the database, for the one-off migration
 * (lib/sqlite-syntax-migration) and for rendering an archived version written
 * for the previous engine (lib/archived-version).
 *
 * A document already in the current data syntax is refused, never converted:
 * the `/` rewrite changes meaning on a second pass (lib/story/data-syntax).
 */
import { catalogOf } from '@/lib/datasets/catalog';
import type { Queryable } from '@/lib/db';
import { hasCurrentDataSyntax } from '@/lib/story/data-syntax';
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

type RefKind = 'dataset' | 'postgres' | 'folder';

const kindOf = (row: Referenced | undefined): RefKind =>
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
  // records every one it could ask about (answering "not Postgres" asks the
  // most), one query answers them all, and the second pass is the conversion.
  const asked = new Set<string>();
  convertDocument(doc.source, { importName: (ref) => void asked.add(ref), isPostgres: (ref) => (asked.add(ref), false) });
  const rows = asked.size
    ? (await db.query<Referenced>('SELECT id,format,title,meta,user_id,token_id,visibility FROM artifacts WHERE id=ANY($1::text[])', [[...asked]])).rows
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lookups: ConvertLookups = {
    importName: (ref) => importTitle(byId.get(ref), doc),
    isPostgres: (ref) => kindOf(byId.get(ref)) === 'postgres',
  };
  const result = convertDocument(doc.source, lookups);
  return { status: result.manual.length ? 'manual' : result.source === doc.source ? 'unchanged' : 'converted', ...result };
}
