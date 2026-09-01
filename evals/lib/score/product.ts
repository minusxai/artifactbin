/**
 * Product truth for a run, from what the product SERVES. The driver never holds
 * the agent's token (the start link handed it to the agent), so it reads the
 * public document rather than the owner API: `/a/<id>/raw?chrome=0` is the
 * document itself, and an anonymous document is born public.
 */
export interface ServedDocument {
  status: number;
  html: string;
}

export interface ProductMetrics {
  published: boolean;
  hasTitle: boolean;
  title: string | null;
}

/** `/a/<id>` — the id is the first path segment after `/a/`, and a pretty URL ends `<id>-<slug>`. */
const ARTIFACT_URL = /\/a\/([A-Za-z0-9]{6,12})(?![A-Za-z0-9])(\/[A-Za-z0-9-]*)?/g;
const PRETTY_URL = /\/@[a-z0-9_]+(?:\/[^\s/]+)*\/([A-Za-z0-9]{6,12})-[^\s]*/g;

/**
 * The artifact an agent NAMES in its answer.
 *
 * The ledger is the first authority on what was written, but it only sees calls
 * that crossed this machine — an agent reaching a public deployment through its
 * provider's own server-side browsing tool leaves none. Its final message still
 * names the document, and scoring the start document instead is how a real run
 * came back as a titleless failure.
 *
 * A `/start?k=` link is excluded on purpose: it names the document the agent was
 * GIVEN, so treating it as an answer scores the untouched original. The LAST
 * link wins: an agent lists what it tried and ends with the deliverable.
 */
export function artifactIdFromText(text: string): string | null {
  const links = [
    ...[...text.matchAll(PRETTY_URL)].map((m) => ({ index: m.index, id: m[1] })),
    ...[...text.matchAll(ARTIFACT_URL)].filter((m) => !(m[2] ?? '').startsWith('/start')).map((m) => ({ index: m.index, id: m[1] })),
  ];
  return links.length ? links.reduce((a, b) => (b.index > a.index ? b : a)).id : null;
}

const PLACEHOLDER_TITLES = new Set(['', 'untitled', 'artifact', 'document']);

export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return decode(m[1]).trim();
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/**
 * ONE pass over the string, deliberately.
 *
 * Unescaping `&amp;` before the rest turns `&amp;lt;` into `&lt;` into `<` —
 * a title an author wrote as literal markup comes back as markup
 * (CodeQL js/double-escaping). A single pass never re-reads what it produced,
 * so a decoded `&` cannot start another entity.
 */
function decode(s: string): string {
  return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole; // an entity we do not know stays as written
  });
}

/** `lib/story-runtime/contract.ts` — the JSON island the served document carries. */
const ISLAND_ID = 'mx-story-data';

/**
 * How many rows the document's queries produced, read from the island.
 *
 * artifactbin runs the dataflow SERVER-SIDE and ships the results with the
 * document, so a static document never calls its own `/query` endpoint — waiting
 * for that request is waiting for something that only happens when a `<Value>`
 * changes. The island is the direct evidence that a `<Query>` ran and returned
 * data, which is what the data task is actually asking about.
 *
 * The island's `dataflow` is `{flow, state}` — the DECLARATIONS and the run —
 * so the results live at `dataflow.state.tables`. Verified against a real
 * served document; a hand-written fixture had them one level up, which made
 * this function return 0 for two documents whose queries had run perfectly.
 */
export function dataflowRows(html: string): number {
  const m = new RegExp(`<script[^>]*id="${ISLAND_ID}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  if (!m) return 0;
  try {
    type Tables = Record<string, { rows?: unknown[] }>;
    const island = JSON.parse(m[1]) as { dataflow?: { state?: { tables?: Tables }; tables?: Tables } };
    const tables = island.dataflow?.state?.tables ?? island.dataflow?.tables ?? {};
    return Object.values(tables).reduce((n, t) => n + (t.rows?.length ?? 0), 0);
  } catch {
    return 0; // a malformed island is no evidence, not a crash
  }
}

const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

/**
 * Did the agent PUBLISH — asked of the product, never of the ledger.
 *
 * This used to read `successfulWrites > 0`, counted from the recording proxy,
 * which made "did the work happen" depend on whether the write crossed THIS
 * machine. It does not always: a provider's server-side browsing tool reaches a
 * public deployment directly, and a live document with real content was then
 * scored unpublished. Whether we could watch the call is not evidence about the
 * document — the ledger's job is how WELL the protocol was used, not whether.
 *
 * The start document is not empty (it serves "Untitled / Waiting for your
 * agent…"), so content alone cannot answer it; the baseline is that document as
 * served before the agent ran, and the served body is byte-stable between reads.
 */
export function productMetrics(input: { served: ServedDocument; baseline: ServedDocument | null }): ProductMetrics {
  const ok = input.served.status === 200;
  const title = ok ? titleOf(input.served.html) : null;
  const body = ok ? bodyOf(input.served.html) : '';
  const hasContent = /<(h1|h2|h3|p|table|ul|ol|section|article|div)\b/i.test(body);
  const base = input.baseline && input.baseline.status === 200 ? bodyOf(input.baseline.html) : null;
  return {
    // With no baseline to compare against, content is the best available answer.
    published: ok && hasContent && (base === null || body !== base),
    hasTitle: ok && title !== null && !PLACEHOLDER_TITLES.has(title.toLowerCase()),
    title: title && title.length ? title : null,
  };
}
