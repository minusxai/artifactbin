/**
 * Reading the recording proxy's ledger — the per-run request log. Pure.
 *
 * The scorer's protocol metrics all come from here: how many calls, how many
 * write attempts before a 2xx, which error code came first, whether the docs
 * were read before the first write, whether what the agent sent survived
 * canonicalization unchanged. The product's own analytics cannot attribute a
 * run (its `client` column is UA-only), so this ledger is the attribution.
 *
 * One ledger per TASK: the proxy that writes it serves one task and skips the
 * driver's own setup calls, so every entry here is that agent's. There is no
 * window to apply — which is what lets a leg's tasks run at the same time.
 */
import type { LedgerEntry } from './contracts';
import { artifactIdFromText } from './score/product';

export function parseLedger(text: string): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LedgerEntry);
    } catch {
      // A torn last line — the proxy was mid-write when the file was read.
    }
  }
  return entries;
}

const pathOnly = (p: string) => p.split('?')[0];

/**
 * Every route the docs teach. A 404 on one of these is a missing RESOURCE
 * (deleting an artifact that is not there); a 404 on anything else is an agent
 * calling an endpoint the product does not have — which is the thing worth
 * measuring, and the thing a doc change can fix.
 */
const KNOWN_ROUTES: RegExp[] = [
  /^\/docs\//,
  /^\/docs$/,
  /^\/docs-human$/,
  /^\/llms\.txt$/,
  /^\/api\/tokens\/anonymous$/,
  /^\/api\/start$/,
  /^\/api\/preview$/,
  /^\/api\/query$/,
  /^\/api\/artifacts$/,
  /^\/api\/artifacts\/[A-Za-z0-9]+$/,
  /^\/api\/artifacts\/[A-Za-z0-9]+\/(edits|revert|versions|annotations)$/,
  // Answering a comment: reply and resolve are one call on the thread's own id.
  /^\/api\/artifacts\/[A-Za-z0-9]+\/annotations\/[A-Za-z0-9_]+$/,
  /^\/api\/artifacts\/[A-Za-z0-9]+\/versions\/\d+$/,
  /^\/api\/my\//,
  /^\/api\/session\/token$/,
  /^\/mcp$/,
  /^\/a\/[A-Za-z0-9]+$/,
  /^\/a\/[A-Za-z0-9]+\/(start|raw|export|query|events|mutate)$/,
  /^\/(webfonts|fonts|story|geojson)\//,
  /^\/[^/]*\.(png|svg|ico|js|css|woff2?)$/,
  /^\/@[a-z0-9_]+/,
];

function isKnownRoute(path: string): boolean {
  return KNOWN_ROUTES.some((re) => re.test(pathOnly(path)));
}

/** A request that changes a document: REST create/replace/edit, or any MCP call (its method is in the body). */
function isWrite(e: LedgerEntry): boolean {
  const p = pathOnly(e.path);
  if (p === '/mcp') return e.method === 'POST';
  if (p === '/api/artifacts') return e.method === 'POST';
  if (/^\/api\/artifacts\/[A-Za-z0-9]+$/.test(p)) return e.method === 'PUT';
  if (/^\/api\/artifacts\/[A-Za-z0-9]+\/(edits|revert)$/.test(p)) return e.method === 'POST';
  return false;
}

/**
 * How many stored VERSIONS the agent's writes produced — the writes above that
 * the product answered, and nothing else.
 *
 * It shares `isWrite` with `writeAttempts` deliberately: the driver counted this
 * with an inline `POST|PUT` regex over `/api/artifacts`, which also matched
 * `POST /api/artifacts/<id>/annotations/<annId>` and reported answering a
 * comment as a new version of the document.
 *
 * Honest limit: an MCP call is a POST to `/mcp` with its method in a body the
 * ledger does not keep, so an `annotate` tool call is indistinguishable from a
 * document write and is still counted. A REST run is exact.
 */
export function documentWrites(entries: LedgerEntry[]): number {
  return entries.filter((e) => e.status < 300 && isWrite(e)).length;
}

/** One numeric row, as the driver records it. */
export interface LedgerRow {
  metric: string;
  /** Null is "unavailable" — the recorder writes nothing and the report shows "—". */
  value: number | null;
}

/**
 * Every numeric row the LEDGER answers, in one place — including `versions`,
 * which is `documentWrites` and nothing else.
 *
 * The driver used to build these inline, and `versions` had its own regex there:
 * a drifted copy of `isWrite` that counted answering a comment as a version of
 * the document. Restoring that regex left the whole suite green, because the
 * predicate was guarded and its CALLER was not. The driver now records exactly
 * what this returns, so the count and its use are one thing to break.
 */
export function ledgerRows(entries: LedgerEntry[]): LedgerRow[] {
  const m = ledgerMetrics(entries);
  return [
    { metric: 'http_calls', value: m.httpCalls },
    { metric: 'write_attempts', value: m.writeAttempts },
    { metric: 'four_xx', value: m.fourXx },
    { metric: 'invented_endpoints', value: m.inventedEndpoints },
    { metric: 'docs_fetches', value: m.docsFetches },
    { metric: 'docs_bytes', value: m.docsBytes },
    // 1 for the document the start link minted, plus every write that stored a new version.
    { metric: 'versions', value: m.observed ? 1 + documentWrites(entries) : null },
  ];
}

/**
 * An address that serves the protocol docs: the listing `/docs`, the tarball
 * `/docs?download=true`, any page under `/docs/`, and `/llms.txt`. These are
 * the product's own entry points, so a run that read any of them read the
 * docs — scoring only `/docs/<file>` called a real docs-first run docs-blind.
 * The query is stripped, so the tarball counts as the listing does.
 */
export function isDocsAddress(path: string): boolean {
  const p = pathOnly(path);
  return p === '/docs' || p.startsWith('/docs/') || p === '/llms.txt';
}

/** Reading the protocol: any docs address, or the start link's instructions. */
function isDocsRead(e: LedgerEntry): boolean {
  const p = pathOnly(e.path);
  return e.method === 'GET' && (isDocsAddress(p) || /^\/a\/[A-Za-z0-9]+\/start$/.test(p));
}

/**
 * The artifact the agent actually published to: the last one it wrote to
 * successfully and did not delete afterwards. Not necessarily the document the
 * start link named — an agent may ignore it and create its own, and it must
 * still be scored on what it made. The deletion clause is from a real run:
 * Claude Opus 5 creates a scratch document, exports it to look at its own
 * rendering, and DELETEs it — the last write, and a 404 to score.
 */
export function targetArtifactId(entries: LedgerEntry[]): string | null {
  const written = survivingWrites(entries);
  return written.length ? written[written.length - 1].artifactId! : null;
}

/** The successful writes whose artifact still exists — an agent's own scratch document is deleted again. */
function survivingWrites(entries: LedgerEntry[]): LedgerEntry[] {
  const deleted = new Set(entries.filter((e) => e.method === 'DELETE' && e.status < 300 && e.artifactId).map((e) => e.artifactId));
  return entries.filter((e) => isWrite(e) && e.status < 300 && e.artifactId && !deleted.has(e.artifactId));
}

/**
 * EVERY artifact this run made and kept, in the order it first touched them — not just the one it is
 * scored on. A run makes more than its deliverable (the data task creates a dataset and then a document
 * that queries it), and under an ACCOUNT token all of them are born private while the scorer reads
 * anonymously. So the driver hands out links to the lot (`lib/credential shareForScoring`), and this is
 * the list. Deduplicated, because a document written five times is one document.
 */
export function writtenArtifactIds(entries: LedgerEntry[]): string[] {
  const ids: string[] = [];
  for (const e of survivingWrites(entries)) {
    if (!ids.includes(e.artifactId!)) ids.push(e.artifactId!);
  }
  return ids;
}

/**
 * Which artifact a run is SCORED on: what the agent says it made, else what the
 * ledger saw it write, else the document it was given. The agent's own answer
 * comes first because the ledger sees only calls that crossed this machine and
 * cannot tell a scratch write from the deliverable; the start document is last
 * because an agent that ignored it must be scored on what it made instead.
 */
export function scoredArtifactId(input: { finalMessage: string | null; ledger: LedgerEntry[]; startId: string }): string {
  return artifactIdFromText(input.finalMessage ?? '') ?? targetArtifactId(input.ledger) ?? input.startId;
}

export interface LedgerMetrics {
  /**
   * Whether this ledger saw ANY traffic. False means the agent reached the
   * product without crossing this machine — a provider's own server-side
   * browsing tool does, against a public deployment — so every judgement below
   * is null: we did not watch, which is not the same as it did not happen.
   */
  observed: boolean;
  httpCalls: number;
  writeAttempts: number;
  fourXx: number;
  /** 404s on a path matching no route the product documents — the agent invented an endpoint. */
  inventedEndpoints: number;
  firstError: string | null;
  readDocsBeforeWrite: boolean | null;
  /** The first write attempt answered 2xx. */
  publishedFirstTry: boolean | null;
  /** Markup echoed by the last successful write equals the markup sent; null when no write carried markup. */
  canonicalStable: boolean | null;
  /** A dataset artifact was created (the data task's first half). */
  datasetCreated: boolean | null;
  /** A change went through the diff endpoint rather than a whole-document replace. */
  usedEditsEndpoint: boolean | null;
  /** At least one write went through the MCP transport. */
  usedMcp: boolean | null;
  /** GETs of a docs address — what the docs path cost this agent. Counts stay observed-only like everything above. */
  docsFetches: number | null;
  /** Bytes those fetches returned; null when the ledger predates `bytes` or saw nothing. */
  docsBytes: number | null;
}

export function ledgerMetrics(entries: LedgerEntry[]): LedgerMetrics {
  const writes = entries.filter(isWrite);
  const firstWriteIdx = entries.findIndex(isWrite);
  const firstErr = entries.find((e) => e.status >= 400);
  const lastGoodWithMarkup = [...writes].reverse().find((w) => w.status < 300 && w.reqMarkup !== undefined);
  // Nothing seen, nothing known. The COUNTS stay — they are literally what was observed — but every
  // judgement about the agent becomes null rather than a false that reads as an accusation.
  const observed = entries.length > 0;
  const judged = <T>(v: T): T | null => (observed ? v : null);
  // What the docs path cost: every GET of a docs address. Bytes only when the
  // ledger recorded them (older ledgers predate the field) — a partial sum would
  // read as a smaller corpus, not an unknown one.
  const docsGets = entries.filter((e) => e.method === 'GET' && isDocsAddress(e.path));
  const docsBytes = docsGets.length && docsGets.every((e) => typeof e.bytes === 'number')
    ? docsGets.reduce((a, e) => a + (e.bytes ?? 0), 0)
    : null;
  return {
    observed,
    httpCalls: entries.length,
    writeAttempts: writes.length,
    fourXx: entries.filter((e) => e.status >= 400 && e.status < 500).length,
    inventedEndpoints: entries.filter((e) => e.status === 404 && !isKnownRoute(e.path)).length,
    firstError: firstErr ? (firstErr.error ?? `http_${firstErr.status}`) : null,
    readDocsBeforeWrite: judged(entries.some((e, i) => isDocsRead(e) && (firstWriteIdx === -1 || i < firstWriteIdx))),
    publishedFirstTry: judged(writes.length > 0 && writes[0].status < 300),
    // `markup_changed:false` IS the answer: the product skips echoing a document
    // it stored verbatim, so a missing echo there means agreement, not silence.
    canonicalStable: lastGoodWithMarkup
      ? (lastGoodWithMarkup.markupUnchanged === true || lastGoodWithMarkup.reqMarkup === lastGoodWithMarkup.resMarkup)
      : null,
    datasetCreated: judged(entries.some((e) => e.status < 300 && e.reqFormat === 'dataset')),
    usedEditsEndpoint: judged(entries.some((e) => e.status < 300 && /^\/api\/artifacts\/[A-Za-z0-9]+\/edits/.test(pathOnly(e.path)))),
    usedMcp: judged(entries.some((e) => e.status < 300 && pathOnly(e.path) === '/mcp' && e.method === 'POST')),
    docsFetches: judged(docsGets.length),
    docsBytes,
  };
}
