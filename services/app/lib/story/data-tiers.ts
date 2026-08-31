/**
 * The data file tiers: dataset (one flat table), viz (an
 * inert recipe template — minusx VizRecipeContent verbatim), image (data-url).
 * Each publishes through the same parseContentInput seam as the other tiers.
 *
 * Datasets: JSON rows, canonical. Declared columns win over inference; rows
 * are validated against them (422 naming row + column). Types: string |
 * number | boolean | date.
 *
 * Recipes: validated against the VizRecipeContent shape + the template token
 * rule from minusx lib/viz/recipe-file.ts — every {{token}} / {{token:kind}}
 * must name a declared binding slot or param; unknown tokens are hard errors
 * naming the token.
 */
import { json } from '../http';
import { MAX_IMAGE_BYTES } from '@/lib/config';
import { storeDatasetRows } from './dataset-store';
import { storeImage, IMAGE_CONTENT_TYPES } from './image-store';
import { optimiseImage } from '@/lib/images/optimise';
import type { StoredContent } from './input';
import type { VizRecipeBinding, VizRecipeParam } from '@/lib/validation/atlas-schemas';

export type { ColumnType, DatasetColumn } from './dataset-shape';
import { inferColumns } from './dataset-shape';
import type { ColumnType, DatasetColumn } from './dataset-shape';

const COLUMN_TYPES: ColumnType[] = ['string', 'number', 'boolean', 'date'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

function valueMatches(v: unknown, t: ColumnType): boolean {
  if (v === null || v === undefined) return true; // nulls pass any column type
  switch (t) {
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'date': return typeof v === 'string' && DATE_RE.test(v);
    case 'string': return typeof v === 'string';
  }
}

export async function publishDataset(body: Record<string, unknown>, rows: unknown): Promise<StoredContent | Response> {
  const details: string[] = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: 'invalid_dataset', details: ['dataset must be a non-empty JSON array of flat objects'] }, 400);
  }
  for (const [i, row] of rows.entries()) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      details.push(`row ${i} is not an object`);
      continue;
    }
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (v !== null && typeof v === 'object') details.push(`row ${i} column "${k}" is nested — datasets are one flat table`);
    }
  }
  if (details.length) return json({ error: 'invalid_dataset', details }, 400);

  const flat = rows as Array<Record<string, unknown>>;
  const declaredRaw = body.columns;
  let columns: DatasetColumn[];
  if (declaredRaw !== undefined && declaredRaw !== null) {
    if (!Array.isArray(declaredRaw)) return json({ error: 'invalid_dataset', details: ['columns must be an array of {name, type}'] }, 400);
    const declared: DatasetColumn[] = [];
    for (const c of declaredRaw) {
      const col = c as { name?: unknown; type?: unknown };
      if (typeof col.name !== 'string' || !COLUMN_TYPES.includes(col.type as ColumnType)) {
        return json({ error: 'invalid_dataset', details: [`bad column declaration ${JSON.stringify(c)} — types: ${COLUMN_TYPES.join('|')}`] }, 400);
      }
      declared.push({ name: col.name, type: col.type as ColumnType });
    }
    // Declared wins; rows are validated against it. Inference fills undeclared columns.
    for (const [i, row] of flat.entries()) {
      for (const col of declared) {
        if (col.name in row && !valueMatches(row[col.name], col.type)) {
          details.push(`row ${i} column "${col.name}": ${JSON.stringify(row[col.name])} is not a ${col.type}`);
        }
      }
    }
    if (details.length) return json({ error: 'invalid_dataset', details }, 400);
    const declaredNames = new Set(declared.map((c) => c.name));
    columns = [...declared, ...inferColumns(flat).filter((c) => !declaredNames.has(c.name))];
  } else {
    columns = inferColumns(flat);
  }

  // The rows go to the object store; the row keeps a reference. See
  // lib/story/dataset-store.ts for why a 27 MB blob cannot live in a column.
  const located = await storeDatasetRows(flat);
  return {
    format: 'dataset',
    content: located.content,
    source: null,
    meta: {
      columns,
      rowCount: flat.length,
      objectKey: located.objectKey,
      // Present only when the source had more rows than we kept.
      ...(body.__truncated ? { totalRows: body.__totalRows, truncated: true } : {}),
    },
    derivedTitle: null,
  };
}

// ── viz recipes ──────────────────────────────────────────────────────────────

/** The {{token}} / {{token:kind}} form — same token grammar as recipe-file.ts. */
const TOKEN_RE = /\{\{([a-zA-Z0-9_-]+)(?::kind)?\}\}/g;

function collectTemplateTokens(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(TOKEN_RE)) out.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) collectTemplateTokens(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectTemplateTokens(v, out);
  }
}

const RECIPE_ACCEPTS = ['nominal', 'quantitative', 'temporal'];

export function publishVizRecipe(_body: Record<string, unknown>, recipe: unknown): StoredContent | Response {
  const details: string[] = [];
  const r = recipe as {
    description?: unknown; engine?: unknown; bindings?: unknown; params?: unknown; template?: unknown;
  } | null;
  if (!r || typeof r !== 'object') return json({ error: 'invalid_viz', details: ['viz must be a VizRecipeContent object'] }, 400);
  if (typeof r.description !== 'string') details.push('description (string) is required');
  if (r.engine !== 'vega-lite' && r.engine !== 'vega') details.push("engine must be 'vega-lite' | 'vega'");
  if (!Array.isArray(r.bindings) || r.bindings.length === 0) details.push('bindings (non-empty array) is required');
  if (!r.template || typeof r.template !== 'object') details.push('template (object) is required');
  const bindings = (Array.isArray(r.bindings) ? r.bindings : []) as VizRecipeBinding[];
  for (const b of bindings) {
    if (typeof b?.name !== 'string' || typeof b?.label !== 'string' || !Array.isArray(b?.accepts)
      || b.accepts.some((a) => !RECIPE_ACCEPTS.includes(a))) {
      details.push(`bad binding ${JSON.stringify(b)} — need {name, label, accepts: (${RECIPE_ACCEPTS.join('|')})[]}`);
    }
  }
  const params = (Array.isArray(r.params) ? r.params : []) as VizRecipeParam[];
  if (details.length) return json({ error: 'invalid_viz', details }, 400);

  // Token rule (recipe-file.ts): every template token names a slot or param.
  const declared = new Set([...bindings.map((b) => b.name), ...params.map((p) => p.name)]);
  const used = new Set<string>();
  collectTemplateTokens(r.template, used);
  for (const tok of used) {
    if (!declared.has(tok)) details.push(`template token {{${tok}}} names no declared binding slot or param`);
  }
  if (details.length) return json({ error: 'invalid_viz', details }, 400);

  return {
    format: 'viz',
    content: JSON.stringify(r),
    source: JSON.stringify(r, null, 2),
    meta: { slots: bindings.map((b) => ({ name: b.name, accepts: b.accepts, ...(b.multi ? { multi: true } : {}) })) },
    derivedTitle: null,
  };
}

// ── images ───────────────────────────────────────────────────────────────────

const IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Store already-decoded image bytes. The single home for both entry points: a
 * base64 `data:` URL (publishImage) and a raw-body upload (the route). Bytes go
 * to the object store; the row keeps `meta.objectKey` and `content` stays empty
 * (see lib/story/image-store).
 */
export async function storeImageContent(buffer: Buffer, contentType: string): Promise<StoredContent | Response> {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return json({ error: 'invalid_image', details: [`unsupported image type "${contentType}" (png|jpeg|webp|gif|svg+xml)`] }, 400);
  }
  if (buffer.length === 0) return json({ error: 'invalid_image', details: ['image is empty'] }, 400);
  if (buffer.length > MAX_IMAGE_BYTES) return json({ error: 'image_too_large', maxBytes: MAX_IMAGE_BYTES }, 413);
  /*
   * THE ONE DOOR every upload comes through — the picker, a paste, a drop and
   * the URL importer all land here — so it is where an image is made fit to
   * read: capped, converted to webp, measured. At PUBLISH rather than on first
   * read, because the first reader of a document is the person its author just
   * handed the link to, and they must not be the one paying for an encode.
   */
  const fit = await optimiseImage(buffer, contentType);
  const located = await storeImage(fit.buffer, fit.contentType);
  return {
    format: 'image',
    content: '',
    source: null,
    meta: {
      contentType: fit.contentType,
      objectKey: located.objectKey,
      bytes: located.bytes,
      // The box the markup reserves, and the stand-in shown while the real
      // bytes travel. Absent when the bytes could not be decoded.
      ...(fit.width && fit.height ? { width: fit.width, height: fit.height } : {}),
      ...(fit.placeholder ? { placeholder: fit.placeholder } : {}),
    },
    derivedTitle: null,
  };
}

export async function publishImage(_body: Record<string, unknown>, dataUrl: string): Promise<StoredContent | Response> {
  const m = IMAGE_DATA_URL_RE.exec(dataUrl);
  if (!m) return json({ error: 'invalid_image', details: ['image must be a base64 data: URL (png|jpeg|webp|gif|svg+xml)'] }, 400);
  return storeImageContent(Buffer.from(m[2], 'base64'), m[1]);
}
