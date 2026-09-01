/**
 * The one-line handoff: a START LINK carries a one-time handle instead of the
 * bearer token, so the paste ("Help me edit my artifact. Follow instructions
 * at <link>") contains no credential. The agent GETs the link for instructions
 * and POSTs it once to claim the write token; the token only ever travels in
 * that POST's response body — never in a URL, never in the clipboard.
 *
 * Handles are `codes` rows (kind 'start'): 128-bit secret in the URL, sha256
 * at rest, ~15-min TTL, subject = the artifact id so a re-issue atomically
 * supersedes the old link. The payload carries the token AND the artifact id —
 * claiming is by hash alone, so the route needs the payload itself to prove
 * the handle belongs to the artifact in the path.
 */
import { randomBytes } from 'crypto';
import { gunzipSync } from 'zlib';
import { agentContract } from './agent-contract';
import { claimByHash, issueCode, peekByHash } from './codes';
import { MAX_CONTENT_BYTES } from './story/input';
import { sha256 } from './tokens';

export const START_HANDLE_TTL_MS = 15 * 60 * 1000;

/**
 * The no-POST path's per-request budget. ChatGPT's fetcher takes any URL up to
 * ~1.4 KB reliably and rejects intermittently past that (measured:
 * chatgpt-fetch-experiment.md), so a chunk's data must leave room for the
 * host, path, and handle inside that envelope.
 */
export const MAX_CHUNK_CHARS = 1_300;

/** Chunks per document — 64 × ~1.3 KB ≈ 83 KB of gzip+base64url ≈ a ~500 KB source, far past the publish cap. */
export const MAX_CHUNKS = 64;

/** What a start handle carries: the write capability and its own scope. */
export interface StartGrant {
  token: string;
  artifact: string;
}

/** Mint (or supersede) the start link's handle for an artifact. Returns the URL secret. */
export async function issueStartHandle(artifactId: string, token: string, now = Date.now()): Promise<string> {
  const secret = randomBytes(16).toString('base64url');
  await issueCode({
    kind: 'start',
    secret,
    subject: artifactId,
    payload: { token, artifact: artifactId },
    ttlMs: START_HANDLE_TTL_MS,
    now,
  });
  return secret;
}

const asGrant = (p: Record<string, unknown> | null, artifactId: string): StartGrant | null =>
  p && typeof p.token === 'string' && p.artifact === artifactId
    ? { token: p.token, artifact: artifactId }
    : null;

/** Non-consuming: is this link live for THIS artifact? (The brief GET, and unfurlers.) */
export async function peekStartHandle(artifactId: string, secret: string, now = Date.now()): Promise<StartGrant | null> {
  return asGrant(await peekByHash({ kind: 'start', code: secret, now }), artifactId);
}

/**
 * The claim: atomic, single-use. A handle presented against the wrong artifact
 * is consumed AND refused — by the time the mismatch is known the row is gone,
 * which is the same replay-stays-closed property the oauth exchange has.
 */
export async function claimStartHandle(artifactId: string, secret: string, now = Date.now()): Promise<StartGrant | null> {
  return asGrant(await claimByHash({ kind: 'start', code: secret, now }), artifactId);
}

/**
 * Buffer one chunk of a no-POST upload. Chunks are `codes` rows too
 * (kind 'chunk'): the (kind, subject) unique makes a re-fired chunk URL an
 * atomic overwrite of itself (idempotent), and the TTL + per-kind sweep make
 * abandoned uploads clean themselves up — no object-store lifecycle rules, no
 * process memory. Keyed by the HANDLE's secret, so chunks die with the link.
 */
export async function storeStartChunk(secret: string, index: number, data: string, now = Date.now()): Promise<void> {
  await issueCode({
    kind: 'chunk',
    secret: `${secret}:${index}`,
    // subject is a PLAINTEXT column, so it carries a hash of the handle —
    // never the handle itself — plus the index that makes re-firing this
    // exact URL an atomic overwrite of itself.
    subject: `${sha256(secret).slice(0, 32)}:${index}`,
    payload: { d: data },
    ttlMs: START_HANDLE_TTL_MS,
    now,
  });
}

/** Read chunks 0…n-1 back. Returns the assembled payload string, or the missing indexes. */
export async function readStartChunks(
  secret: string,
  n: number,
  now = Date.now(),
): Promise<{ ok: true; joined: string } | { ok: false; missing: number[] }> {
  const parts: string[] = [];
  const missing: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = await peekByHash({ kind: 'chunk', code: `${secret}:${i}`, now });
    if (p && typeof p.d === 'string') parts.push(p.d);
    else missing.push(i);
  }
  return missing.length ? { ok: false, missing } : { ok: true, joined: parts.join('') };
}

/**
 * Decode an assembled payload: base64url, then gunzip when the gzip magic is
 * present — plain base64url of raw utf8 is accepted too, so an agent with no
 * gzip at hand (or a human hand-building a URL) still has a path.
 */
export function decodeChunkPayload(joined: string): string | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(joined, 'base64url');
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      // Bounded: ~80KB of chunks can carry a multi-GB-ratio gzip. Without the
      // cap the bomb fully inflates BEFORE the publish size check can refuse
      // it; with it, zlib aborts the moment output crosses what any publish
      // could accept.
      return gunzipSync(bytes, { maxOutputLength: MAX_CONTENT_BYTES + 1 }).toString('utf8');
    } catch {
      return null;
    }
  }
  return bytes.toString('utf8');
}

/**
 * The single line a human pastes into any agent — the SAME line for a
 * brand-new document and an existing one, because both hand over an artifact
 * that already exists (a fresh start doc is a placeholder the agent edits).
 * The brief behind the link is what varies (mode, below).
 */
export { startLinkPaste as startPrompt } from './agent-copy';

/**
 * What a brand-new document says before an agent touches it: a centered holding
 * state with a blinking caret, because this page is what the user STARES AT
 * while they paste the instruction — a bare heading in the corner reads as a
 * broken page rather than as a document waiting its turn.
 *
 * Still deliberately ordinary markup: the first agent edit is an ordinary edit,
 * with no empty-document special case anywhere in the protocol, so the waiting
 * line stays a plain unique text anchor. The caret blinks on `animate-caret-blink`
 * (shipped by the story compile — the markup tier has no `<style>`, so custom
 * keyframes can only come from there) and is green rather than themed: this
 * document has no theme yet, and green is the one that reads as a live terminal.
 */
const WAITING_LINE = 'Waiting for your agent…';
export const START_PLACEHOLDER_MARKUP =
  '<div data-design="tw" className="@container flex min-h-[var(--mx-vh,760px)] flex-col items-center justify-center gap-4 px-6 text-center">' +
  '<h1 className="text-2xl font-semibold tracking-tight">Untitled</h1>' +
  `<p className="font-mono text-sm text-muted-foreground">${WAITING_LINE}` +
  '<span className="ml-1.5 inline-block h-4 w-2 align-middle animate-caret-blink bg-emerald-500"></span>' +
  '</p></div>';

/**
 * Which briefing a document needs: an untouched placeholder is FILLED, real
 * content is READ FIRST and edited in place. Decided from the source itself —
 * the waiting line is the placeholder's stable text anchor, so the answer
 * cannot depend on which door issued the link.
 */
export type StartMode = 'fill' | 'edit';
export function startModeForSource(source: string): StartMode {
  return source.includes(WAITING_LINE) ? 'fill' : 'edit';
}

/**
 * The brief the link's GET serves — short, none of it a secret. It used to
 * carry the whole quick sheet inline, which made the start page and
 * /docs/artifactbin/SKILL.md the same 8 KB at two addresses; now the sheet
 * lives at ONE address and the brief points at it. The exact next command is
 * still spelled out because "obtain credentials somehow" is where agents
 * wander; a copy-pastable curl is where they comply.
 */
export function startBrief(base: string, artifactId: string, secret: string, mode: StartMode = 'fill'): string {
  const self = `${base}/a/${artifactId}/start?k=${secret}`;
  const modeBlock = mode === 'fill'
    ? `This document is an empty PLACEHOLDER — fill it. Publish it COMPLETE in one
call when you can produce it in one go:

\`\`\`bash
curl -X PUT ${base}/api/artifacts/${artifactId} \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"title":"…","markup":"…"}'
\`\`\`

Only when it will take several minutes, land a complete first screen first —
the human is watching, and a first screen beats a placeholder — and make every
later write a targeted \`/edits\` call (the brief shows the shape).`
    : `This document has REAL CONTENT. Read it first — \`GET ${base}/api/artifacts/${artifactId}\`
returns the current \`markup\` and an \`edit_id\` — then make targeted edits
(\`POST ${base}/api/artifacts/${artifactId}/edits\`): change what was asked and
leave the rest alone, landing edits as you go rather than in one big rewrite.`;
  return `# You are editing artifact \`${artifactId}\`

The human who pasted this link is WATCHING ${base}/a/${artifactId} live.

## 1. Get your write token (one-time)

\`\`\`bash
curl -X POST "${self}"
\`\`\`

Returns \`{"token": "..."}\`. This link is single-use and expires in minutes —
claim it now and keep the token: **every \`/api\` call, \`GET\` included, sends
\`Authorization: Bearer <token>\`.**

## 2. Read the brief, then write

Read ${base}/docs/artifactbin/SKILL.md first — enough for a straightforward
document; ${base}/docs lists the rest, one line each saying when to read it.

${modeBlock}

${agentContract(base)}

If the artifactbin skills or plugin are installed in your session, use them —
they carry the same brief and the MCP tools; if not, you may mention to your
user that the plugin makes this smoother next time.

## Can't send POST requests or headers? (GET-only clients)

Write the document with plain GET fetches of this same URL — no token needed.
Base64url-encode the markup source (gzip first is optional) and split it into
pieces of at most 1,300 characters:

1. Send each piece:   \`GET ${self}&i=<index>&d=<piece>\`   (index from 0)
2. Finish:            \`GET ${self}&done=1&n=<total pieces>\`
   — the response contains the live document URL to hand to the human.

Each URL must stay under ~1,400 characters; re-sending a piece is harmless, and
a failed finish names any missing pieces — send them and repeat. If your fetch
tool refuses URLs you constructed yourself, PRINT the numbered URLs for the
human to click — they are safe to re-click and carry no credentials.
`;
}
