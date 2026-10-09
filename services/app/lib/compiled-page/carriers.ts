/**
 * THE CARRIER WIRE FORMAT: the inert data blocks at the tail of a compiled version's stored HTML.
 *
 * The compiler (bundle.server) renders the story and appends, in this order:
 *   - `<script type="application/json" data-mx-island-literals="<key>">[…]</script>`: the browser
 *     module's string literals, which the module reads by DOM lookup at evaluation (`literalsReadCode`);
 *   - `<script type="application/json" data-mx-module-data>{"moduleData":[…]}</script>`: the version's
 *     large constants, which the assembler moves into the page's one data island (`ISLAND_DATA_ID`), where
 *     the module reads them (`MODULE_DATA_READ_CODE`).
 *
 * Serve, the assembler, the offline file and the morph engine read them back through this module only.
 * Stored pages are served unchanged, so the bytes written here are a stored contract: a change needs a
 * handover-contract bump and a backfill. Pure and browser-safe. The literals attribute is a reader id
 * (lib/story-runtime/contract), which the morph engine reads.
 */
import { scriptJson } from '@artifactbin/utils/escape';
import { ISLAND_DATA_ID, LITERALS_ATTR } from '@/lib/story-runtime/contract';

export const MODULE_DATA_ATTR = 'data-mx-module-data';

const LITERALS_OPEN = `<script type="application/json" ${LITERALS_ATTR}=`;
const MODULE_DATA_OPEN = `<script type="application/json" ${MODULE_DATA_ATTR}>`;
const CLOSE = '</script>';
/** Every literals carrier; the key is the literals' contentSha (16 hex). */
const LITERALS_RE = new RegExp(`${LITERALS_OPEN}"[0-9a-f]{16}">[\\s\\S]*?${CLOSE.replace('/', '\\/')}`, 'g');
/** The module-data opener, also as an HTML serialiser may have written it (`=""`). */
const MODULE_DATA_OPEN_RE = new RegExp(`<script type="application\\/json" ${MODULE_DATA_ATTR}(?:="")?>`);

/** The carriers the compiler writes after the rendered story; '' for either part that is empty. */
export function emitCarriers(lits: { literals: readonly string[]; key: string } | null, moduleData: readonly unknown[] | null): string {
  return (lits?.literals.length ? `${LITERALS_OPEN}"${lits.key}">${scriptJson(lits.literals).replace(/&/g, '\\u0026')}${CLOSE}` : '')
    + (moduleData?.length ? `${MODULE_DATA_OPEN}${scriptJson({ moduleData })}${CLOSE}` : '');
}

interface SplitCarriers {
  /** The html without its carriers. */
  story: string;
  /** Every literals carrier, as tags, in document order ('' when none). */
  literals: string;
  /** The trailing module-data carrier's constants (null when none). */
  moduleData: unknown[] | null;
  /** That carrier as its tag ('' when none). */
  moduleDataTag: string;
}

/** The carriers as text, never parsed: what moving them needs (`withStoredCarriers`). */
function sliceCarriers(html: string): Omit<SplitCarriers, 'moduleData'> {
  const start = html.endsWith(CLOSE) ? html.lastIndexOf(MODULE_DATA_OPEN) : -1;
  const story = start >= 0 ? html.slice(0, start) : html;
  const literals = [...story.matchAll(LITERALS_RE)].map((match) => match[0]).join('');
  return { story: literals ? story.replace(LITERALS_RE, '') : story, literals, moduleDataTag: start >= 0 ? html.slice(start) : '' };
}

/** Read the carriers back: the module-data carrier only as the html's trailing block, the literals anywhere. */
export function splitCarriers(html: string): SplitCarriers {
  const sliced = sliceCarriers(html);
  if (!sliced.moduleDataTag) return { ...sliced, moduleData: null };
  const parsed: unknown = JSON.parse(sliced.moduleDataTag.slice(MODULE_DATA_OPEN.length, -CLOSE.length));
  if (!parsed || typeof parsed !== 'object' || !('moduleData' in parsed) || !Array.isArray(parsed.moduleData)) throw new Error('carriers: invalid module data');
  return { ...sliced, moduleData: parsed.moduleData };
}

/**
 * A fresh SSR render with the version's stored carriers: the SSR module renders only the document tree,
 * while the carriers are version-owned and exist in its stored first render. A kind the render already
 * carries is kept, never duplicated; with nothing missing the render comes back as it is. Never parses
 * the module data: the assembler's one `splitCarriers` does.
 */
export function withStoredCarriers(rendered: string, storedHtml: string): string {
  const fresh = sliceCarriers(rendered);
  if (fresh.literals && fresh.moduleDataTag) return rendered;
  const stored = sliceCarriers(storedHtml);
  if ((fresh.literals || !stored.literals) && (fresh.moduleDataTag || !stored.moduleDataTag)) return rendered;
  return fresh.story + (fresh.literals || stored.literals) + (fresh.moduleDataTag || stored.moduleDataTag);
}

/** The module-data carrier under the page data id, for a page with no assembler to move it (the offline file). */
export const withModuleDataId = (html: string): string =>
  html.replace(MODULE_DATA_OPEN_RE, `<script type="application/json" id="${ISLAND_DATA_ID}" ${MODULE_DATA_ATTR}>`);

/** The browser module's first line when it has literals: it reads its own carrier by key. */
export const literalsReadCode = (key: string): string =>
  `const $mxL=JSON.parse(document.querySelector('script[${LITERALS_ATTR}="${key}"]').textContent);\n`;

/** The browser module's first line when it has module data: the assembler moved it into the page data island. */
export const MODULE_DATA_READ_CODE = `const $moduleData = JSON.parse(document.getElementById("${ISLAND_DATA_ID}").textContent).moduleData;\n`;
