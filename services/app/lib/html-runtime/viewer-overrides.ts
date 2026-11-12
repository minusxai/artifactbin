/**
 * How a viewer's saved state combines with the page's defaults (the state block). Pure; ./viewer-state applies it, so
 * `@afbin/state` and comment views see the same document.
 *
 * The browser keeps only the viewer's OVERRIDES: top-level keys whose value differed from the defaults when written.
 * The document is the current defaults with those overrides merged over them one level deep (a saved nested object
 * replaces the default object whole). So a new default key, or a changed default the viewer never touched, reaches
 * everyone who saved. An override whose JSON type no longer matches its default's is dropped (a `null` default takes
 * any value: it means "nothing chosen yet"); keys without a default keep their override. Removing a key that has a
 * default brings the default back. A changed page state version (`data-af-state-version`) clears every override once.
 *
 * Stored as `{"$af":"overrides","version":…,"revision":…,"overrides":{…}}` under its OWN key (page-state: `af:viewer:v2:<id>`).
 *
 * Reads never write. An entry of another state version reads as the defaults alone; the first write replaces it. Each
 * entry records the page revision that wrote it: an instance of an OLDER revision never writes over it (./viewer-state
 * rejects its writes), so two open versions of a page cannot erase each other's overrides.
 */
import type { HtmlJson, HtmlJsonObject } from '@artifactbin/contracts';
import { canonical, clone, createLocalStore, own, setOwn } from './apollo/local-store';

export interface StoredOverrides { $af: 'overrides'; version: string | null; revision: string | null; overrides: HtmlJsonObject }
/** What storage says for this viewer: its overrides, and the state version and page revision they were written under. */
export type OverrideEntry = Pick<StoredOverrides, 'version' | 'revision' | 'overrides'>;

const jsonType = (value: HtmlJson) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The keys of `document` that are not simply the default. */
export function overridesOf(document: HtmlJsonObject, defaults: HtmlJsonObject): HtmlJsonObject {
  return Object.fromEntries(Object.entries(document).filter(([key, value]) => canonical(own(defaults, key)) !== canonical(value)).map(([key, value]) => [key, clone(value)]));
}

/** The document: the defaults, then each override whose type still fits its default. */
function mergeOverrides(defaults: HtmlJsonObject, overrides: HtmlJsonObject): HtmlJsonObject {
  const document = clone(defaults);
  for (const [key, value] of Object.entries(overrides)) {
    const fallback = own(defaults, key);
    if (fallback !== undefined && fallback !== null && jsonType(fallback) !== jsonType(value)) continue;
    setOwn(document, key, clone(value));
  }
  return document;
}

export const storedOverrides = (entry: OverrideEntry): StoredOverrides => ({ $af: 'overrides', version: entry.version, revision: entry.revision, overrides: entry.overrides });

/** The new key's value (throws when it is not a valid entry). */
export function parseEntry(raw: string): OverrideEntry {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || value.$af !== 'overrides' || !isObject(value.overrides) || Object.keys(value).length !== 4
    || !(value.version === null || typeof value.version === 'string') || !(value.revision === null || typeof value.revision === 'string')) throw new TypeError('Saved viewer state is not an overrides entry');
  return { version: value.version, revision: value.revision, overrides: createLocalStore(value.overrides as HtmlJsonObject).read() };
}

/** The document an entry shows this page: another state version's overrides do not apply. */
export const entryDocument = (entry: OverrideEntry | null, defaults: HtmlJsonObject, version: string | null): HtmlJsonObject =>
  mergeOverrides(defaults, entry && entry.version === version ? entry.overrides : {});

const decimal = (value: string | null): bigint | null => value !== null && /^\d{1,30}$/.test(value) ? BigInt(value) : null;
/** True when `stored` is a later page revision than `mine` (both saved revisions; `local` and unknown ones never fence). */
export function isNewerRevision(stored: string | null, mine: string | null): boolean {
  const a = decimal(stored), b = decimal(mine);
  return a !== null && b !== null && a > b;
}
