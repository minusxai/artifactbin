/**
 * The start link — GET/POST /a/:id/start?k=<handle> (lib/start-links).
 *
 * GET  = the agent-facing brief: markdown instructions, NO token. Non-consuming
 *        and unfurl-safe — a link-preview bot fetching the paste learns nothing
 *        and spends nothing. `no-store` + `noindex`: this URL carries a secret.
 * POST + k = the one-time claim: answers {token} and spends the handle.
 * POST without k = owner re-issue ("copy again"): a fresh link for this
 *        artifact, authed by the artifact's own bearer token or the owner's
 *        session — the path out of an expired/used link.
 *
 * A dead handle answers 410 everywhere (not 404): the resource existed, the
 * fix is a fresh link, and telling the agent that is actionable.
 */
import { auth } from '@/auth';
import { getArtifactById, getArtifactFor, byteQuotaFor, fontResolver, assetImporterFor, refLoaderForActor, replaceArtifactFor, type ArtifactRow } from '@/lib/artifacts';
import { resolveToken } from '@/lib/tokens';
import { sessionActor } from '@/lib/viewer';
import { baseUrl, json, unauthorized } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { parseContentInput } from '@/lib/story/input';
import {
  claimStartHandle,
  decodeChunkPayload,
  issueStartHandle,
  MAX_CHUNK_CHARS,
  MAX_CHUNKS,
  peekStartHandle,
  readStartChunks,
  startBrief,
  startModeForSource,
  startPrompt,
  storeStartChunk,
} from '@/lib/start-links';

/**
 * The tombstone is read by an AGENT mid-run, where "ask the person who sent
 * it" is advice it cannot take — there is nobody in the loop. So it names the
 * cause it can fix itself (a mistyped `k=`, measured: one leg dropped a single
 * character and then spent seven 4xx guessing endpoints) and the two doors
 * that need no link at all.
 */
const goneText = (base: string) => [
  'This start link is spent, expired, or copied wrong — check every character of the `k=` value against what you were given.',
  '',
  'You do not need it to continue:',
  `  POST ${base}/api/tokens/anonymous   → a token, no account needed`,
  `  GET  ${base}/docs/artifactbin/references/publishing.md → the whole API`,
  '',
  'For the original document, ask the person who sent the link for a fresh one.',
].join('\n');

const gone = (request: Request) => new Response(goneText(baseUrl(request)), {
  status: 410,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
});

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return gone(request);
  const q = new URL(request.url).searchParams;
  const k = q.get('k');
  if (!k) return gone(request);
  const base = baseUrl(request);

  // ── the finish call: assemble, publish, spend the link ────────────────────
  // Ordered before the liveness check so a REPLAYED done (a retrying agent, a
  // crawler) still gets the artifact URL instead of a bare tombstone.
  if (q.get('done') === '1') {
    const grant = await peekStartHandle(id, k);
    if (!grant) return text(`${goneText(base)}\n\nThe document lives at ${base}/a/${id}`, 410);
    const n = Number(q.get('n'));
    if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) {
      return text(`done needs n=<total chunks>, an integer 1..${MAX_CHUNKS}.`, 400);
    }
    const chunks = await readStartChunks(k, n);
    if (!chunks.ok) {
      return text(`Missing chunk index(es): ${chunks.missing.join(', ')} of ${n}. Send them, then repeat this call.`, 400);
    }
    const source = decodeChunkPayload(chunks.joined);
    if (source === null) {
      return text('The assembled payload does not decode (d must be base64url of the markup source, optionally gzipped first) or is too large once inflated.', 400);
    }
    const resolved = await resolveToken(grant.token);
    if (!resolved) return gone(request); // the token was revoked under the link
    const actor = { tokenId: resolved.id, userId: resolved.userId };
    const parsed = await parseContentInput({ markup: source }, {
      loadRef: refLoaderForActor(actor),
      importAsset: assetImporterFor(actor.tokenId, actor.userId),
      resolveFont: fontResolver(),
      overByteQuota: byteQuotaFor(actor.tokenId),
    });
    if (parsed instanceof Response) return parsed; // the validator's diagnostics, verbatim
    const row = await replaceArtifactFor(actor, id, { ...parsed, title: parsed.derivedTitle ?? undefined });
    if (!row || 'currentVersion' in row) return text('The document changed underneath this upload — start a fresh link.', 409);
    // Spent HERE, not earlier: only a successful publish consumes the link, so
    // a failed done (missing chunk, bad payload) can be corrected and retried.
    await claimStartHandle(id, k);
    return text(`Published. The document is live at ${base}/a/${id} — share that link.`, 200);
  }

  // ── one chunk: buffered, idempotent, non-consuming ─────────────────────────
  const idx = q.get('i');
  const d = q.get('d');
  if (idx !== null || d !== null) {
    if (!(await peekStartHandle(id, k))) return gone(request);
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= MAX_CHUNKS || d === null || d === '') {
      return text(`A chunk needs i=<0..${MAX_CHUNKS - 1}> and d=<base64url data>.`, 400);
    }
    if (d.length > MAX_CHUNK_CHARS) {
      return text(`Chunk too large: ${d.length} chars; the cap is 1,300 per request. Split it further.`, 414);
    }
    await storeStartChunk(k, i, d);
    return text(`Stored chunk ${i}. Send the rest, then GET this URL with &done=1&n=<total> instead of i/d.`, 200);
  }

  // ── the brief ───────────────────────────────────────────────────────────────
  if (!(await peekStartHandle(id, k))) return gone(request);
  // Fill vs edit is a fact about the DOCUMENT, not about which door issued the
  // link: an untouched placeholder is filled, real content is read first and
  // edited in place. Derived here so a re-issued link tells the truth too.
  const row = await getArtifactById(id);
  const mode = row?.source ? startModeForSource(row.source) : 'fill';
  return text(startBrief(base, id, k, mode), 200, { 'X-Robots-Tag': 'noindex, nofollow' });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return gone(request);
  const k = new URL(request.url).searchParams.get('k');

  if (k) {
    const grant = await claimStartHandle(id, k);
    if (!grant) return gone(request);
    return json({ token: grant.token }, 200);
  }

  // Owner re-issue. Bearer first (the browser holds the artifact's token),
  // then session; a non-owner gets the uniform 404, never "exists but not yours".
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  /*
   * WHO IS ASKING is the actor header's answer, not a lookup in `tokens`: that
   * table belongs to identity, and where identity has its own role the app
   * cannot read it — an owner holding a perfectly good token was told
   * `unauthorized` on their own document. `resolveToken` stays as the fallback
   * for a process with no proxy in front (a direct handler call in a test).
   */
  const actor = await sessionActor(request);
  const resolved = actor.credential === 'bearer' && actor.tokenId
    ? { id: actor.tokenId, userId: actor.viewer?.userId ?? null }
    : (offered && actor.credential === 'none' ? await resolveToken(offered) : null);
  let owned: ArtifactRow | null = resolved
    ? await getArtifactFor({ tokenId: resolved.id, userId: resolved.userId }, id)
    : null;
  if (!owned && !resolved) {
    // The session, from the actor header when a proxy is in front, and from
    // `auth()` otherwise. try/catch, not .catch(): it throws synchronously
    // off-request.
    let userId: string | null = actor.viewer?.userId ?? null;
    try {
      userId ??= (await auth())?.user?.id ?? null;
    } catch {
      userId ??= null;
    }
    if (!userId) return unauthorized(request);
    // Account-scope actor: with userId set the tokenId is never consulted.
    owned = await getArtifactFor({ tokenId: '', userId }, id);
  }
  if (!owned) return json({ error: 'not_found' }, 404);

  // The re-issued handle must still carry a WORKING token. The artifact's own
  // creating token is the one credential we can hand out here; for a bearer
  // caller that is exactly what they presented.
  if (!resolved) {
    // Session re-issue needs a token to put in the grant; the artifact's
    // creating token is not recoverable (hash-only). Mint through the bearer
    // path instead — the UI always holds the token for docs it started.
    return json({ error: 'reissue_requires_token' }, 400);
  }
  const row = await getArtifactById(id);
  if (!row) return json({ error: 'not_found' }, 404);
  const secret = await issueStartHandle(id, offered);
  return json({ prompt: startPrompt(baseUrl(request), id, secret) }, 200);
}
