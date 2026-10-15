/**
 * A CLASS THE PAGE'S DATA BRINGS, STYLED (lib/serving/runtime-css.server, lib/data/story/story-css RUNTIME CLASSES).
 *
 * A document's Tailwind is compiled from the classes its markup names. A class its rows fill
 * (`className="{$_row.cls}"`) is noted here as the kit computes it (`noteClasses`, from lib/islands/row-class and the
 * cell controls). One its sheet lacks:
 *
 *  1. is HIDDEN at once — a `visibility: hidden` rule for exactly the new classes, written in the same task the
 *     element gets them, so nothing unstyled is ever painted;
 *  2. is asked for together with every other new one (one request per burst, `ASK_DELAY_MS`) at the version's door,
 *     which answers the document's WHOLE sheet with them compiled in — a sheet appended after it would reorder the
 *     cascade (Tailwind puts `w-full` before `md:w-1/2`);
 *  3. the answer REPLACES the page's Tailwind (`data-mx-tw`, and on a document with linked shared sheets every
 *     `data-mx-tw-s<n>` shard and `data-mx-tw-i<n>` part) where it stood, ahead of every other sheet — the base sheets,
 *     the design system and the author's `<style>` keep following it — and the hiding rule goes.
 *
 * A failed answer unhides (the classes stay unstyled, as before this existed) and is not asked again. Only a page
 * whose data names the door (`IslandPageData.css`: a version that fills classes at runtime) runs any of it; the
 * server already compiled the classes of the rows it drew (`css.extras`). A newly drawn version (the live morph)
 * brings its own door and sheet: the classes noted so far are asked for again against it.
 *
 * On the server (the SSR render) nothing is configured and `noteClasses` returns at once.
 */
import { isRuntimeClassToken, RUNTIME_CLASS_LIMIT } from '@/lib/data/story/story-css';
import { ISLAND_DATA_ID, STORY_VERSION_DRAWN_EVENT } from '@/lib/story-runtime/contract';
import type { IslandPageData } from './contract';

/** How long the page waits for more new classes before asking: one render's rows arrive together. */
const ASK_DELAY_MS = 16;
/** The rule that hides an element whose classes are on their way. */
export const RUNTIME_PENDING_ATTR = 'data-mx-runtime-pending';
const TAILWIND_PREFIX = 'data-mx-tw';

type Data = NonNullable<IslandPageData['css']>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface Session {
  doc: Document;
  fetch: FetchLike;
  credentials: RequestCredentials;
  data: Data;
  /** The classes the document names itself: never asked for. */
  named: Set<string>;
  /** Every class the sheet has a rule for, or that was asked for (answered or not). */
  known: Set<string>;
  /** Waiting for the next ask. */
  pending: Set<string>;
  /** Every runtime class noted on this page, asked for again when a new version brings a new sheet. */
  seen: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  asking: Promise<void> | null;
  stop: () => void;
}

let session: Session | null = null;

const escapeClass = (token: string): string =>
  (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(token) : token.replace(/[^\w-]/g, (c) => `\\${c}`));

const knownOf = (data: Data): Set<string> => new Set([...data.known, ...(data.extras ?? [])]);

/** Hide exactly the classes on their way (and nothing once none are). */
function hidePending(s: Session): void {
  let style = s.doc.head.querySelector<HTMLStyleElement>(`style[${RUNTIME_PENDING_ATTR}]`);
  if (!s.pending.size) { style?.remove(); return; }
  if (!style) {
    style = s.doc.createElement('style');
    style.setAttribute(RUNTIME_PENDING_ATTR, '');
    s.doc.head.append(style);
  }
  style.textContent = `${[...s.pending].map((token) => `.${escapeClass(token)}`).join(',')}{visibility:hidden!important}`;
}

/** Replace the page's Tailwind, in all its parts, with `css`, where its first part stood. */
export function swapTailwindSheet(doc: Document, css: string): boolean {
  const parts = [...doc.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')]
    .filter((el) => el.getAttributeNames().some((name) => name === TAILWIND_PREFIX || name.startsWith(`${TAILWIND_PREFIX}-`)));
  const first = parts[0];
  if (!first) return false;
  const sheet = doc.createElement('style');
  sheet.setAttribute(TAILWIND_PREFIX, '');
  sheet.textContent = css;
  first.before(sheet);
  for (const part of parts) part.remove();
  return true;
}

function schedule(s: Session): void {
  if (s.timer !== null || s.asking) return;
  s.timer = setTimeout(() => { s.timer = null; s.asking = ask(s).finally(() => { s.asking = null; if (s.pending.size && session === s) schedule(s); }); }, ASK_DELAY_MS);
}

async function ask(s: Session): Promise<void> {
  const asking = [...s.pending];
  if (!asking.length) return;
  // Every runtime class this version needs, the served ones included: the answer is the WHOLE sheet.
  const extras = [...new Set([...(s.data.extras ?? []), ...[...s.seen].filter((token) => !s.named.has(token))])].sort().slice(0, RUNTIME_CLASS_LIMIT);
  const url = `${s.data.url}${s.data.url.includes('?') ? '&' : '?'}x=${encodeURIComponent(extras.join(' '))}`;
  try {
    const res = await s.fetch(url, { credentials: s.credentials });
    if (!res.ok) throw new Error(`runtime css ${res.status}`);
    const css = await res.text();
    if (session === s) swapTailwindSheet(s.doc, css);
  } catch (error) {
    console.warn('[runtime-css] the sheet for this page\'s data could not be fetched; its new classes stay unstyled', error);
  } finally {
    for (const token of asking) { s.known.add(token); s.pending.delete(token); }
    if (session === s) hidePending(s);
  }
}

/**
 * The classes `value` names, as the kit is about to set them: any the sheet has no rule for is hidden until the
 * page's sheet has it. A no-op on a page whose data names no door, and on the server.
 */
export function noteClasses(value: unknown): void {
  const s = session;
  if (!s || typeof value !== 'string' || !value) return;
  let added = false;
  for (const token of value.split(/\s+/)) {
    if (!token || s.known.has(token) || s.pending.has(token) || !isRuntimeClassToken(token)) continue;
    if (s.seen.size >= RUNTIME_CLASS_LIMIT && !s.seen.has(token)) continue;
    s.seen.add(token);
    s.pending.add(token);
    added = true;
  }
  if (!added) return;
  hidePending(s);
  schedule(s);
}

const readData = (doc: Document): Data | null => {
  try {
    const data = JSON.parse(doc.getElementById(ISLAND_DATA_ID)?.textContent || 'null') as IslandPageData | null;
    return data?.css ?? null;
  } catch { return null; }
};

/**
 * Start noting runtime classes for this page (lib/islands/boot, when its data names the door). `credentials`: the
 * page's own-origin doors carry its pages cookie (`include`). Returns the stop.
 */
export function startRuntimeCss(win: Window, data: Data, options: { credentials: RequestCredentials; fetch?: FetchLike }): () => void {
  session?.stop();
  const doc = win.document;
  const s: Session = {
    doc, data, credentials: options.credentials, fetch: options.fetch ?? ((url, init) => win.fetch(url, init)),
    named: new Set(data.known), known: knownOf(data), pending: new Set(), seen: new Set(), timer: null, asking: null, stop: () => {},
  };
  // A newly drawn version brings its own door and its own sheet: what this page drew so far is asked for against it.
  const onVersion = () => {
    const next = readData(doc);
    if (!next) return;
    s.data = next;
    s.named = new Set(next.known);
    s.known = knownOf(next);
    for (const token of s.seen) if (!s.known.has(token)) s.pending.add(token);
    hidePending(s);
    if (s.pending.size) schedule(s);
  };
  doc.addEventListener(STORY_VERSION_DRAWN_EVENT, onVersion);
  s.stop = () => {
    doc.removeEventListener(STORY_VERSION_DRAWN_EVENT, onVersion);
    if (s.timer !== null) clearTimeout(s.timer);
    s.pending.clear();
    hidePending(s);
    if (session === s) session = null;
  };
  session = s;
  return s.stop;
}
