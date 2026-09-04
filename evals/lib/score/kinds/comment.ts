/**
 * The `comment` kind: a human left a comment on the document, and the agent has
 * to answer it — make the change, reply on the thread, resolve it.
 *
 * SETUP posts that comment before the agent runs; CHECKS reads what came back.
 * Two sources, because one `GET` cannot answer all three: the THREAD comes from
 * `GET /api/artifacts/<id>/annotations?status=all` — the artifact GET inlines
 * only the OPEN set, so a resolved thread has left it and a PERFECT run would
 * score `responded:false, resolved:false` — and the DOCUMENT comes from
 * `/a/<id>/raw?chrome=0`, the same served truth every other product check reads.
 *
 * The predicates below are pure and transport-free — the setup and the checks
 * are the only things here that touch the wire.
 */
import { DriverFailure, type CheckContext, type TaskScorer } from './contract';
// The ONE deterministic function from a web URL to where this product serves our
// copy of it. Imported rather than re-spelled: a second sha256-of-the-canonical-URL
// here would grade a stale address forever the day canonicalization moves, and
// silently pass while doing it. `contracts.ts` already reaches into the app this way.
import { assetUrlFor } from '../../../../services/app/lib/story/asset-url';

/**
 * The checks about the PICTURES a comment asked for, which only the image
 * variant grades. Named apart from the rest so `validate` can ask "does this
 * task grade any of these?" in one place rather than three.
 */
export const ASSET_CHECKS = ['urls_kept', 'assets_served', 'assets_ok'] as const;

/** Declared apart from the scorer for the reason `publish.ts` gives: `contracts.ts` reads these names. */
export const COMMENT_CHECKS = ['responded', 'changed', 'resolved', ...ASSET_CHECKS] as const;

// ---------------------------------------------------------------- the thread

/** One comment in a thread, as the annotation wire spells it. */
export interface ThreadComment {
  author: { kind: string; label: string | null; transport: string };
}

/** One annotation thread, as `{annotations: […]}` carries it. */
export interface AnnotationThread {
  status: string;
  thread: ThreadComment[];
}

export interface ThreadMetrics {
  /** A reply from the AGENT — not merely a second comment. */
  responded: boolean;
  resolved: boolean;
  /** For the report: who answered, e.g. "Claude Code (mcp)". Empty when nobody did. */
  agentLabel: string;
}

export function threadMetrics(annotations: AnnotationThread[]): ThreadMetrics {
  const replies = annotations.flatMap((a) => a.thread.slice(1)).filter((c) => c.author.kind === 'agent');
  const first = replies[0];
  return {
    responded: replies.length > 0,
    // Every thread, because the task posts exactly one; `every` on an empty
    // list is true, so an absent thread must answer false explicitly.
    resolved: annotations.length > 0 && annotations.every((a) => a.status === 'resolved'),
    agentLabel: first ? `${first.author.label ?? 'agent'} (${first.author.transport})` : '',
  };
}

// ---------------------------------------------------------------- the document

const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

/**
 * Words, for comparison: tags dropped, entities left alone (the seed carries
 * none), INTERNAL punctuation kept — "1,284" and "1284" are different numbers
 * and a predicate that cannot tell them apart is not checking that nothing was
 * lost.
 *
 * `loose` additionally lowercases and drops punctuation that TRAILS a word.
 * That is the seam a correct split lands on: cutting a paragraph between two
 * sentences leaves the first half's terminal period optional and makes the
 * second half's first word start a sentence, so an agent that writes English
 * rather than bytes drops the period or re-capitalises — measured against the
 * real fixture, where exact equality answered false for both. A CI gate that
 * fails a correct answer is how a gate gets turned off. It stays strict about
 * everything INSIDE a word, so a lost clause and a changed number still fail.
 */
const words = (s: string, loose = false): string[] => {
  const plain = s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim().split(/\s+/).filter(Boolean);
  return loose ? plain.map((w) => w.toLowerCase().replace(/[.,;:!?"'\u2019\u201d)]+$/u, '')).filter(Boolean) : plain;
};

/** The `<p>` elements of a served document, as plain-text word arrays, in order. */
export function paragraphWords(html: string, loose = false): string[][] {
  const body = bodyOf(html);
  return [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => words(m[1], loose));
}

/**
 * The task's `changed` predicate: the seeded paragraph's words now read across
 * TWO OR MORE `<p>` elements, in order, with nothing lost.
 *
 * Word sequences, never markup shapes: the served document is SSR React
 * carrying `data-mx-ast` stamps and whatever whitespace the agent wrote, and a
 * predicate that regexes `<p>` shapes grades the serializer.
 *
 * "Across two" is a CONSECUTIVE run of paragraphs whose concatenated words are
 * the seeded ones — consecutive because a paragraph split in place stays in
 * place, and a full match in both directions because "no words lost" must also
 * refuse an invented clause. `loose` (the default, and what the eval GATES on)
 * forgives punctuation at the seam and the case of the new sentence's first
 * word; `splitVerbatim` below asks the same question byte-exactly and is
 * RECORDED rather than gated.
 */
export function splitAcrossParagraphs(html: string, seededText: string, loose = true): boolean {
  const want = words(seededText, loose);
  if (want.length === 0) return false;
  const paras = paragraphWords(html, loose);
  for (let start = 0; start < paras.length; start++) {
    const run: string[] = [];
    for (let end = start; end < paras.length; end++) {
      run.push(...paras[end]);
      if (run.length > want.length) break;
      if (end > start && run.length === want.length && run.every((w, i) => w === want[i])) return true;
    }
  }
  return false;
}

/**
 * The same question asked BYTE-EXACTLY: every word, its punctuation and its
 * case survive the split unchanged.
 *
 * Recorded beside `changed`, never gated. Gating it would fail a correct split
 * that dropped a seam period; recording it says whether the agent MOVED the
 * words or rewrote them, which is a real difference worth seeing in the report.
 */
export function splitVerbatim(html: string, seededText: string): boolean {
  return splitAcrossParagraphs(html, seededText, false);
}

// ------------------------------------------------- the pictures a comment asked for

/**
 * THE THREE ASSET PREDICATES, and the split between them is the point.
 *
 * `urlsKept` is about STORAGE — the URL the agent wrote is the URL it reads
 * back, which is the whole promise of URL-kept external assets and the thing
 * the retired `ref:` rewrite broke. `assetsServed` is about the READER — what a
 * browser is actually told to fetch, and therefore the "no request to the
 * source host" claim, made BY CONSTRUCTION because this scorer has no browser.
 * `assetOk` is about the BYTES behind that address.
 *
 * All three are pure. The reads they need live at the bottom of this module
 * beside `readThreads`, because a scoring read is the DRIVER's and its failure
 * is `checks_ok`, never the agent's answer.
 */

/** Every `<img src>` in a served document's body, in order, as written. */
export function imageSources(html: string): string[] {
  return [...bodyOf(html).matchAll(/<img\b[^>]*>/gi)]
    .map((m) => /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[0]))
    .map((m) => (m ? (m[2] ?? m[3] ?? '') : ''))
    .filter(Boolean);
}

/** For the report: how many pictures the document ended up with. */
export const imageCount = (html: string): number => imageSources(html).length;

/**
 * `urls_kept` — every URL the comment asked for is in the STORED markup,
 * verbatim.
 *
 * An empty ask answers FALSE, not true: `every` over nothing is vacuously true,
 * and a gated check with no subject that cannot fail is not a check.
 */
export function urlsKept(markup: string, urls: readonly string[]): boolean {
  return urls.length > 0 && urls.every((url) => markup.includes(url));
}

const HOST_OF = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * `assets_served` — the reader is sent to OUR origin for every one of them, and
 * to the source host for nothing at all.
 *
 * The address is matched by PREFIX because it may grow a query (`?v=…`), and
 * `assetUrlFor` is the product's own mapping rather than a second spelling of
 * it. The negative half is deliberately wider than the two URLs the comment
 * named: "opening this document tells the upstream host nothing" is a claim
 * about the whole page, and one stray `<img>` on the source host breaks it
 * whether or not the comment asked for that one.
 */
export function assetsServed(html: string, urls: readonly string[]): boolean {
  if (urls.length === 0) return false;
  const srcs = imageSources(html);
  const hosts = new Set(urls.map(HOST_OF).filter((h): h is string => h !== null));
  if (srcs.some((src) => { const h = HOST_OF(src); return h !== null && hosts.has(h); })) return false;
  return urls.every((url) => srcs.some((src) => src.startsWith(assetUrlFor(url))));
}

/** The one type whose bytes must survive the import untouched (`lib/images/optimise` LEAVE_ALONE). */
export const needsSourceIdentity = (contentType: string): boolean =>
  contentType.split(';')[0].trim().toLowerCase() === 'image/svg+xml';

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * `assets_ok`, for ONE address: our copy answers 200 as an image, and — where
 * the product stores it untouched — is byte-identical to what the source
 * served.
 *
 * A raster image is only required to BE an image: it is re-encoded to WebP at
 * publish, so byte equality would be a check that must always fail. An SVG with
 * no source to compare against is not a pass either — the identity rule is what
 * this check is for, and skipping it silently is how it would rot.
 */
export function assetOk(a: { status: number; contentType: string; bytes: Uint8Array; sourceBytes: Uint8Array | null }): boolean {
  if (a.status !== 200) return false;
  if (!a.contentType.split(';')[0].trim().toLowerCase().startsWith('image/')) return false;
  if (!needsSourceIdentity(a.contentType)) return true;
  return a.sourceBytes !== null && sameBytes(a.bytes, a.sourceBytes);
}

/** Tags that can plausibly hold a one-line caption. A `<p>` can too — the word ceiling is what tells them apart. */
const CAPTION_TAGS = 'figcaption|p|em|i|small|span|div|figure';
/** Above this, what follows the picture is the document continuing, not a caption. A HINT, and recorded as one. */
const CAPTION_MAX_WORDS = 25;

/**
 * For the report: does a short line of words follow this picture?
 *
 * Deliberately a HINT and never a gate, so it is a scan rather than a parser:
 * the first text-bearing element after the image, whatever closing tags stand
 * between, capped at a length no body paragraph would fit inside. A document
 * that captions its figure some other way reads false here and loses nothing.
 */
export function captionAfter(html: string, url: string): boolean {
  const body = bodyOf(html);
  const address = assetUrlFor(url);
  const img = [...body.matchAll(/<img\b[^>]*>/gi)].find((m) => new RegExp(`\\ssrc\\s*=\\s*["']${address}`, 'i').test(m[0]));
  if (!img) return false;
  const after = body.slice(img.index + img[0].length);
  const next = new RegExp(`^(?:\\s|</[a-zA-Z][^>]*>)*<(${CAPTION_TAGS})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'i').exec(after);
  if (!next) return false;
  const said = next[2].replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean);
  return said.length > 0 && said.length <= CAPTION_MAX_WORDS;
}

// ---------------------------------------------------------------- the kind

/**
 * The comment the driver posts, and the paragraph it is about, are TASK data —
 * `comment.path` is a BODY path and counts every parsed node, whitespace text
 * nodes included, so a seed written one tag per line does NOT have its second
 * paragraph at "1". Seeds for this kind are written with no whitespace between
 * the siblings they count, and setup asserts the anchored text is the one the
 * task grades rather than trusting the count.
 */
export const commentScorer = {
  kind: 'comment',
  checkNames: COMMENT_CHECKS,

  /**
   * What this kind needs of a task's JSON — asked of the CHECKS THE TASK LISTS,
   * never of the kind as a whole.
   *
   * Two variants share this kind: one asks for a paragraph to be split, the
   * other for two pictures to be added. Each must be free of the other's data,
   * so `seedSplitText` is owed only by the task that grades `changed` and
   * `assetUrls` only by the task that grades the asset checks. What is common to
   * both — the comment, the seed, the credential to post with — is owed always.
   */
  validate(task) {
    if (!task.comment) return 'a comment task must declare the `comment` it posts (path, body)';
    if (!task.seed) return 'a comment task must declare the `seed` it comments on';
    // Creation is a BROWSER door, so the driver has to hold the credential itself.
    if (task.handoff !== 'token') return 'a comment task needs `handoff: "token"`: only the driver can post the comment';
    const graded = new Set<string>(task.checks);
    if (graded.has('changed') && !task.seedSplitText) {
      return 'a comment task grading `changed` must declare `seedSplitText` — the paragraph it grades';
    }
    if (ASSET_CHECKS.some((c) => graded.has(c))) {
      const urls = task.assetUrls ?? [];
      if (urls.length === 0) return `a comment task grading ${ASSET_CHECKS.join('/')} must declare the \`assetUrls\` it grades`;
      // The URL the scorer grades must be the URL the agent was ASKED for. Two copies
      // of a string in one file is exactly where drift starts, and a drifted one would
      // fail every run for a reason no row names.
      const stray = urls.find((u) => !task.comment?.body.includes(u));
      if (stray) return `assetUrls names ${stray}, which the comment body never asks the agent for`;
    }
    return null;
  },

  /**
   * Post the task's comment on the seeded document, as its owner would from the browser.
   *
   * Creation is a BROWSER door — no bearer route creates an annotation — so the driver exchanges
   * the token it already holds for the agent-session cookie and posts with a same-site `Origin`.
   * Four calls, each named, because a failure here must say WHICH one broke: the driver's traffic
   * is invisible to the ledger, so an unnamed failure reads as "the agent did nothing".
   */
  async setup(ctx) {
    const { task, base, id, token } = ctx;
    const comment = task.comment;
    if (!comment) return;
    if (!token) throw new DriverFailure('credential', `task ${task.id} posts a comment and so needs a token handoff`);
    const driver = { ...ctx.driverHeaders, 'content-type': 'application/json' };

    const exchange = await fetch(`${base}/api/session/token`, {
      method: 'POST', headers: { ...driver, origin: base }, body: JSON.stringify({ token }),
    });
    const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
    if (!exchange.ok || !cookie) throw new DriverFailure('agent-cookie exchange', `POST /api/session/token → ${exchange.status}`);

    const head = await fetch(`${base}/api/artifacts/${id}`, { headers: { ...driver, authorization: `Bearer ${token}` } });
    if (!head.ok) throw new DriverFailure('reading edit_id', `GET /api/artifacts/${id} → ${head.status}`);
    const { edit_id: editId } = (await head.json()) as { edit_id: string };

    const res = await fetch(`${base}/api/my/artifacts/${id}/annotations`, {
      method: 'POST', headers: { ...driver, origin: base, cookie },
      body: JSON.stringify({ ...comment, edit_id: editId }),
    });
    if (res.status !== 201) throw new DriverFailure('posting the comment', `POST /api/my/artifacts/${id}/annotations → ${res.status} ${await res.text()}`);
    const created = (await res.json()) as { id: string; snippet?: string };

    // The path is a body path over PARSED nodes, so a seed whose whitespace shifts anchors the
    // comment to the wrong paragraph — or to none — and the run would then fail `changed` as if
    // the agent had ignored it. Assert the anchored text IS the paragraph the task grades.
    const anchored = (created.snippet ?? '').replace(/\s+/g, ' ').trim();
    const wanted = (task.seedSplitText ?? '').replace(/\s+/g, ' ').trim();
    if (wanted && anchored !== wanted) {
      throw new DriverFailure('anchoring the comment', `comment.path "${comment.path}" anchored to ${JSON.stringify(anchored)}, not to the paragraph seedSplitText names`);
    }
    // …and the same assertion for a variant that grades no paragraph: the QUOTE is the
    // words the comment is about, so an anchor that does not contain them landed on the
    // wrong node — and the run would then fail as if the agent had ignored the comment.
    const quote = (comment.quote ?? '').replace(/\s+/g, ' ').trim();
    if (quote && !anchored.includes(quote)) {
      throw new DriverFailure('anchoring the comment', `comment.path "${comment.path}" anchored to ${JSON.stringify(anchored)}, which does not contain the quote it is about`);
    }
    ctx.log(`commented ${created.id} on ${id}`);
  },

  /**
   * Two reads, because one `GET` cannot answer all three (see the module note).
   *
   * The thread is read from the document the agent was GIVEN, never from the one it happened to
   * write: the comment is on the start document, and reading an agent's own fresh document would
   * score an empty list as "no thread" rather than as "did not answer".
   */
  async checks(ctx) {
    const { task } = ctx;
    const unanswered = { responded: null, changed: null, resolved: null, urls_kept: null, assets_served: null, assets_ok: null };
    if (!task.comment) return unanswered;
    const threads = await readThreads(ctx.productUrl, ctx.startId, ctx.token, ctx.driverHeaders);
    const tm = threadMetrics(threads);
    ctx.record('answered_by', tm.agentLabel, 'text');
    const seeded = task.seedSplitText ?? '';
    // Byte-exact beside the gated one: whether the agent MOVED the words or rewrote them is worth
    // seeing and is not worth failing a run over (a correct split may drop the seam's period).
    if (seeded) ctx.record('split_verbatim', splitVerbatim(ctx.served.html, seeded), 'pass');
    return {
      responded: tm.responded,
      resolved: tm.resolved,
      changed: seeded ? splitAcrossParagraphs(ctx.served.html, seeded) : null,
      ...(await assetChecks(ctx)),
    };
  },
} as const satisfies TaskScorer;

/**
 * Every thread on a document, open and resolved alike — a resolved one has left the artifact GET.
 *
 * A failed read THROWS rather than answering `[]`. An empty list is a real answer ("nobody has
 * commented"), and using it for "we could not ask" scores a 500 or an expired token as an agent that
 * ignored the comment — the same instrument-blindness `setup_ok` exists to refuse one step earlier.
 */
async function readThreads(base: string, id: string, token: string | null, driverHeaders: Record<string, string>): Promise<AnnotationThread[]> {
  const url = `${base}/api/artifacts/${id}/annotations?status=all`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { ...driverHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  } catch (e) {
    throw new DriverFailure('reading the thread', `GET ${url} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new DriverFailure('reading the thread', `GET ${url} → ${res.status}`);
  return ((await res.json()) as { annotations?: AnnotationThread[] }).annotations ?? [];
}

// ---------------------------------------------------------------- the asset reads

/**
 * The three asset checks, and the two reads they need beyond the served document.
 *
 * The STORED markup is read from the document the agent was GIVEN — the same
 * rule `readThreads` follows and for the same reason: this is a comment on ONE
 * document, and an agent that published somewhere else has not answered it.
 *
 * Both reads go to the product's OWN address, never to the task's recording
 * proxy: a scoring read has no business in the ledger the agent is judged on.
 * The source fetch is the one call in this file that leaves the machine.
 */
async function assetChecks(ctx: CheckContext): Promise<Record<string, boolean | null>> {
  const urls = ctx.task.assetUrls ?? [];
  if (urls.length === 0) return { urls_kept: null, assets_served: null, assets_ok: null };
  const markup = await readStoredMarkup(ctx.productUrl, ctx.startId, ctx.token, ctx.driverHeaders);
  ctx.record('image_count', imageCount(ctx.served.html), 'number');
  // The caption was asked for on the LAST picture the comment named — the one it says
  // "with a one-line caption" about. A hint for the reader, never a gate (see captionAfter).
  ctx.record('caption_present', captionAfter(ctx.served.html, urls[urls.length - 1]), 'pass');
  return {
    urls_kept: urlsKept(markup, urls),
    assets_served: assetsServed(ctx.served.html, urls),
    assets_ok: await assetsOk(ctx.productUrl, urls, ctx.driverHeaders),
  };
}

/** The document as the OWNER reads it back — what the product actually stored. */
async function readStoredMarkup(base: string, id: string, token: string | null, driverHeaders: Record<string, string>): Promise<string> {
  const url = `${base}/api/artifacts/${id}`;
  if (!token) throw new DriverFailure('reading the stored markup', `GET ${url} — the driver holds no token`);
  let res: Response;
  try {
    res = await fetch(url, { headers: { ...driverHeaders, authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new DriverFailure('reading the stored markup', `GET ${url} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new DriverFailure('reading the stored markup', `GET ${url} → ${res.status}`);
  return ((await res.json()) as { markup?: string }).markup ?? '';
}

/**
 * Ask the product for our copy of each URL, and the SOURCE for the one type
 * stored untouched.
 *
 * The distinction that matters: a NON-200 from the product is an answer — the
 * asset is not there, and that is the agent's run failing. A fetch that THROWS,
 * on either side, is our instrument, and a network blip must not be reported as
 * a wrong picture (`checks_ok`, the same rule `readThreads` follows).
 */
async function assetsOk(base: string, urls: readonly string[], driverHeaders: Record<string, string>): Promise<boolean> {
  for (const url of urls) {
    const address = `${base}${assetUrlFor(url)}`;
    let res: Response;
    try {
      res = await fetch(address, { headers: driverHeaders });
    } catch (e) {
      throw new DriverFailure('reading the asset', `GET ${address} — ${e instanceof Error ? e.message : String(e)}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sourceBytes = res.status === 200 && needsSourceIdentity(contentType) ? await readSource(url) : null;
    if (!assetOk({ status: res.status, contentType, bytes, sourceBytes })) return false;
  }
  return true;
}

/** The upstream bytes, fetched once, only for the identity rule. A failure here is the DRIVER's. */
async function readSource(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new DriverFailure('fetching the source asset', `GET ${url} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new DriverFailure('fetching the source asset', `GET ${url} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
