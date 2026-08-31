/**
 * The one-line handoff and the documented start-link alternative. `/api/start`
 * returns the decided paste; tests issue a handle directly when exercising the
 * separate GET/POST start-link protocol.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';

// The re-issue route consults auth() when no bearer is presented; this file
// owns the mock (mutable id, '' = signed out) like the other session suites.
const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));
import { GET as startBrief, POST as startClaim } from '@/app/a/[id]/start/route';
import { POST as apiStart } from '@/app/api/start/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { anonymousPaste, ownedPaste } from '@/lib/agent-copy';
import { issueStartHandle } from '@/lib/start-links';
import { createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * Create an anonymous start doc, then issue a handle directly for tests of the
 * alternative start-link protocol.
 */
async function start() {
  const res = await apiStart(request('/api/start', { method: 'POST' }));
  const body = await res.json();
  const k = await issueStartHandle(body.id, body.token);
  return {
    ...body,
    startPath: `/a/${body.id}/start?k=${k}`,
    k,
  };
}

beforeEach(() => {
  sessionUser.id = '';
});

describe('the paste', () => {
  it('is the anonymous one-line paste with the returned token inline', async () => {
    const s = await start();
    expect(s.prompt).toBe(anonymousPaste(BASE, s.id, s.token));
    expect(s.prompt).toContain(s.token);
    expect(s.prompt.split('\n')).toHaveLength(1);
    expect(s.prompt.length).toBeLessThan(160); // a line, not an essay
    expect(s.token).toMatch(/^mx_/);
  });

  it('uses the owned paste for a signed-in session without exposing a token', async () => {
    const user = await createUser({ email: 'owned-start@example.com' });
    sessionUser.id = user.id;
    const res = await apiStart(request('/api/start', { method: 'POST' }));
    const body = await res.json();

    expect(body.prompt).toBe(ownedPaste(BASE, body.id));
    expect(body.prompt).not.toContain('mx_');
    expect(body.prompt).not.toContain('/tokens/new');
    expect(body).not.toHaveProperty('token');
  });
});

describe('GET /a/<id>/start?k= — the brief', () => {
  it('answers markdown that teaches the claim, carries no token, and does not consume', async () => {
    const s = await start();
    const res = await startBrief(request(s.startPath), params(s.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const text = await res.text();
    expect(text).toContain(s.id);
    expect(text).toContain('/docs');
    expect(text).toMatch(/POST/); // the exact next move
    expect(text).not.toMatch(/mx_[A-Za-z0-9_-]{20,}/); // never a real token (`mx_…` is contract notation)
    // Non-consuming: a second read (a link unfurler) still works.
    const again = await startBrief(request(s.startPath), params(s.id));
    expect(again.status).toBe(200);
  });

  /**
   * The brief used to CARRY the whole quick sheet, which made the start page
   * and /docs/artifact-bin/SKILL.md the same 8 KB at two addresses. Phase D:
   * the sheet lives at ONE address and the brief points at it — the cost is
   * exactly one fetch, and the brief itself stays a page an agent reads in one
   * screenful.
   */
  it('points at the sheet instead of carrying it', async () => {
    const s = await start();
    const text = await (await startBrief(request(s.startPath), params(s.id))).text();
    expect(text).not.toContain('<SlideDeck>');       // the sheet's grammar lives in the sheet
    expect(text).toContain('/docs/artifact-bin/SKILL.md');
    expect(text).not.toMatch(/mx_[A-Za-z0-9_-]{20,}/);
  });

  /**
   * One more line, measured with the entry-point change (§18): an agent whose
   * harness has the plugin installed should use it rather than re-fetch what
   * it already holds — and one WITHOUT it should be able to mention the plugin
   * to its user, not be told to install anything itself.
   */
  it('names the plugin as the smoother path without demanding it', async () => {
    const s = await start();
    const text = await (await startBrief(request(s.startPath), params(s.id))).text();
    expect(text).toMatch(/skills|plugin/i);
    expect(text).not.toMatch(/must install|install the plugin first/i);
  });

  /**
   * Publishing in stages exists so the watching human sees progress — but it
   * was written unconditionally, which turns every one-shot document into
   * several round trips of the whole context.
   */
  it('asks for staged edits only when the document will take a while', async () => {
    const s = await start();
    const text = await (await startBrief(request(s.startPath), params(s.id))).text();
    expect(text).toMatch(/one go|single PUT|in one pass/i);
  });

  it('spells the publish command ONCE, against this document id', async () => {
    const s = await start();
    const text = await (await startBrief(request(s.startPath), params(s.id))).text();
    const commands = text.split('curl -X PUT').length - 1;
    expect(commands).toBe(1);
    expect(text).toContain(`/api/artifacts/${s.id}`);
  });

  /**
   * The artifactId switch (PUT vs POST) extended to a MODE: a fresh start doc
   * is a placeholder ("fill it"), but a re-issued link for a document that has
   * REAL CONTENT must say the opposite — read it first, then targeted /edits —
   * or the agent politely replaces a document it was asked to amend.
   */
  it('a document with real content gets the edit briefing, not the fill briefing', async () => {
    const s = await start();
    const put = await putArtifact(
      request(`/api/artifacts/${s.id}`, { method: 'PUT', token: s.token, json: { title: 'real', markup: '<h1>Real content</h1>' } }),
      params(s.id),
    );
    expect(put.status).toBe(200);
    const re = await startClaim(request(`/a/${s.id}/start`, { method: 'POST', token: s.token }), params(s.id));
    const { prompt } = await re.json();
    const k = /\/start\?k=([A-Za-z0-9_-]+)/.exec(prompt ?? '')?.[1];
    const text = await (await startBrief(request(`/a/${s.id}/start?k=${k}`), params(s.id))).text();
    expect(text).toContain('/edits');
    expect(text).toContain(`/api/artifacts/${s.id}`); // read it first
    expect(text).not.toContain('curl -X PUT');        // no whole-replace coaching
    expect(text).not.toMatch(/placeholder/i);
  });

  it('410s a bogus or missing handle', async () => {
    const s = await start();
    expect((await startBrief(request(`/a/${s.id}/start?k=nope`), params(s.id))).status).toBe(410);
    expect((await startBrief(request(`/a/${s.id}/start`), params(s.id))).status).toBe(410);
  });

  /**
   * A dead start link must not be a dead END. Measured: pi transcribed the
   * `k=` value one character short (`…UYiNv70v…` → `…UYiN70v…`), got the
   * tombstone, and spent the next several turns guessing — `/docs/markup.md`,
   * `/api`, then `/api/artifacts` with no token at all (401) — before it
   * thought to mint one. 35 turns and 7 4xx on a task its sibling did in 6.
   *
   * The old text said only "ask the person who sent it", which is advice an
   * agent cannot act on: there is no person in the loop mid-run. So the
   * tombstone now names the two ways forward it actually has — mint an
   * anonymous token, read the protocol doc — and names mistyping as a cause,
   * since that is the one the agent can fix by itself.
   */
  it('the tombstone hands an agent a way forward instead of a person to ask', async () => {
    const s = await start();
    const body = await (await startBrief(request(`/a/${s.id}/start?k=nope`), params(s.id))).text();
    expect(body).toMatch(/copied|mistyp|character/i);
    expect(body).toContain('/api/tokens/anonymous');
    expect(body).toContain('/docs/artifact-bin/references/publishing.md');
  });

  it('410s a handle presented against a DIFFERENT artifact', async () => {
    const a = await start();
    const b = await start();
    const res = await startBrief(request(`/a/${b.id}/start?k=${a.k}`), params(b.id));
    expect(res.status).toBe(410);
  });
});

describe('POST /a/<id>/start?k= — the claim', () => {
  it('hands out the working token exactly once', async () => {
    const s = await start();
    const res = await startClaim(request(s.startPath, { method: 'POST' }), params(s.id));
    expect(res.status).toBe(200);
    const { token } = await res.json();
    expect(token).toBe(s.token);

    // The claimed token actually writes.
    const put = await putArtifact(
      request(`/api/artifacts/${s.id}`, { method: 'PUT', token: token, json: { title: 'claimed', markup: '<h1>Claimed</h1>' } }),
      params(s.id),
    );
    expect(put.status).toBe(200);

    // Spent: the second claim and the brief both answer 410.
    expect((await startClaim(request(s.startPath, { method: 'POST' }), params(s.id))).status).toBe(410);
    expect((await startBrief(request(s.startPath), params(s.id))).status).toBe(410);
  });

  it('410s an expired handle', async () => {
    const s = await start();
    const db = await harness.db();
    await db.query("UPDATE codes SET expires_at = now() - interval '1 minute' WHERE kind = 'start'");
    expect((await startClaim(request(s.startPath, { method: 'POST' }), params(s.id))).status).toBe(410);
  });
});

describe('owner re-issue — POST /a/<id>/start with auth, no k', () => {
  it('mints a fresh working link and kills the old handle', async () => {
    const s = await start();
    const res = await startClaim(request(`/a/${s.id}/start`, { method: 'POST', token: s.token }), params(s.id));
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    const m = /\/start\?k=([A-Za-z0-9_-]+)/.exec(prompt ?? '');
    expect(m, `no handle in re-issued prompt: ${prompt}`).toBeTruthy();
    expect(prompt).not.toContain('mx_');

    // The old handle is superseded; the new one works.
    expect((await startBrief(request(s.startPath), params(s.id))).status).toBe(410);
    expect((await startBrief(request(`/a/${s.id}/start?k=${m![1]}`), params(s.id))).status).toBe(200);
  });

  it('401s without credentials and 404s a non-owner', async () => {
    const s = await start();
    expect((await startClaim(request(`/a/${s.id}/start`, { method: 'POST' }), params(s.id))).status).toBe(401);
    const other = await start(); // someone else's token
    expect((await startClaim(request(`/a/${s.id}/start`, { method: 'POST', token: other.token }), params(s.id))).status).toBe(404);
  });

  it('a session owner without the token gets the named 400, not a broken link', async () => {
    // Structural: a re-issued handle must carry a WORKING token, and the
    // artifact's creating token is hash-only — only a bearer caller can
    // re-arm. A session owner is told exactly that instead of receiving a
    // link whose claim would hand out nothing.
    const s = await start();
    const { createUser } = await import('@/lib/users');
    const user = await createUser({ email: 'reissue@example.com' });
    const db = await harness.db();
    await db.query('UPDATE artifacts SET user_id = $1 WHERE id = $2', [user.id, s.id]);
    sessionUser.id = user.id;
    const res = await startClaim(request(`/a/${s.id}/start`, { method: 'POST' }), params(s.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('reissue_requires_token');
  });
});

// ── P2: the no-POST path (ChatGPT) — chunked GET-writes on the same link ────

import { gzipSync } from 'zlib';

const MARKUP = '<div data-design="tw" className="p-8"><h1 className="text-3xl font-bold">Chunked</h1><p>Landed by GET alone.</p></div>';

/** Split a gzip+base64url payload into n roughly-even chunks. */
function chunksOf(source: string, size: number): string[] {
  const b64 = gzipSync(Buffer.from(source, 'utf8')).toString('base64url');
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

const chunkReq = (path: string) => request(path);

describe('chunked GET-writes (the no-POST path)', () => {
  it('stores chunks idempotently, assembles on done, and publishes as the handle token', async () => {
    const s = await start();
    const parts = chunksOf(MARKUP, 40); // several small chunks
    for (const [i, d] of parts.entries()) {
      const res = await startBrief(chunkReq(`${s.startPath}&i=${i}&d=${encodeURIComponent(d)}`), params(s.id));
      expect(res.status).toBe(200);
    }
    // Idempotent: re-firing a chunk (a crawler) is a no-op 200.
    const again = await startBrief(chunkReq(`${s.startPath}&i=0&d=${encodeURIComponent(parts[0])}`), params(s.id));
    expect(again.status).toBe(200);

    const done = await startBrief(chunkReq(`${s.startPath}&done=1&n=${parts.length}`), params(s.id));
    expect(done.status).toBe(200);
    const text = await done.text();
    expect(text).toContain(`/a/${s.id}`); // the public link rides the body

    // The document actually changed, through the normal publish pipeline.
    const db = await harness.db();
    const row = (await db.query<{ source: string; format: string }>('SELECT source, format FROM artifacts WHERE id = $1', [s.id])).rows[0];
    expect(row.format).toBe('markup');
    expect(row.source).toContain('Landed by GET alone.');
  });

  it('accepts plain base64url too (no gzip) — the lowest-dependency agent path', async () => {
    const s = await start();
    const b64 = Buffer.from(MARKUP, 'utf8').toString('base64url');
    const res = await startBrief(chunkReq(`${s.startPath}&i=0&d=${encodeURIComponent(b64)}`), params(s.id));
    expect(res.status).toBe(200);
    const done = await startBrief(chunkReq(`${s.startPath}&done=1&n=1`), params(s.id));
    expect(done.status).toBe(200);
  });

  it('names the missing chunks instead of publishing a hole', async () => {
    const s = await start();
    const parts = chunksOf(MARKUP, 40);
    await startBrief(chunkReq(`${s.startPath}&i=0&d=${encodeURIComponent(parts[0])}`), params(s.id));
    // claim n = parts.length but only chunk 0 was sent
    const done = await startBrief(chunkReq(`${s.startPath}&done=1&n=${parts.length}`), params(s.id));
    expect(done.status).toBe(400);
    expect(await done.text()).toContain('1'); // names a missing index
  });

  it('rejects an oversized chunk with a named error', async () => {
    const s = await start();
    const res = await startBrief(chunkReq(`${s.startPath}&i=0&d=${'A'.repeat(2000)}`), params(s.id));
    expect(res.status).toBe(414);
    expect(await res.text()).toContain('1,300');
  });

  it('rejects an unpublishable assembly with the validator diagnostics', async () => {
    const s = await start();
    const bad = Buffer.from('<div className={evil()}>nope</div>', 'utf8').toString('base64url');
    await startBrief(chunkReq(`${s.startPath}&i=0&d=${encodeURIComponent(bad)}`), params(s.id));
    const done = await startBrief(chunkReq(`${s.startPath}&done=1&n=1`), params(s.id));
    expect(done.status).toBe(400);
  });

  it('done consumes the handle: replay answers 410 WITH the artifact link', async () => {
    const s = await start();
    const b64 = Buffer.from(MARKUP, 'utf8').toString('base64url');
    await startBrief(chunkReq(`${s.startPath}&i=0&d=${encodeURIComponent(b64)}`), params(s.id));
    expect((await startBrief(chunkReq(`${s.startPath}&done=1&n=1`), params(s.id))).status).toBe(200);
    const replay = await startBrief(chunkReq(`${s.startPath}&done=1&n=1`), params(s.id));
    expect(replay.status).toBe(410);
    expect(await replay.text()).toContain(`/a/${s.id}`); // still helpful to a retrying agent
  });

  it('refuses a zip bomb at decode time, never materializing it', async () => {
    // 60 MB of zeros gzips to ~60 KB — 63 chunks, inside every cap. Without a
    // bounded gunzip the server inflates the whole thing before the publish
    // cap can refuse it.
    const s = await start();
    const bomb = gzipSync(Buffer.alloc(60 * 1024 * 1024)).toString('base64url');
    const pieces: string[] = [];
    for (let i = 0; i < bomb.length; i += 1300) pieces.push(bomb.slice(i, i + 1300));
    for (const [i, d] of pieces.entries()) {
      await startBrief(chunkReq(`${s.startPath}&i=${i}&d=${encodeURIComponent(d)}`), params(s.id));
    }
    const done = await startBrief(chunkReq(`${s.startPath}&done=1&n=${pieces.length}`), params(s.id));
    expect(done.status).toBe(400);
    expect(await done.text()).toContain('too large');
  });

  it('chunks against a dead handle answer 410', async () => {
    const s = await start();
    await startClaim(request(s.startPath, { method: 'POST' }), params(s.id)); // spend it the other way
    const res = await startBrief(chunkReq(`${s.startPath}&i=0&d=QQ`), params(s.id));
    expect(res.status).toBe(410);
  });
});

/**
 * WHERE the reference is named decides whether it is found. Measured on the
 * production matrix: Claude Code read this brief, then asked for `/docs`
 * (307 to the human tour), `/api/docs`, `/api/artifacts/<id>/schema`,
 * `/api/components` and `/llms.txt` — five 404s and two redirects — and
 * reached `/docs/llm` on its TENTH request. The brief did name it, at line 122
 * of about 140, below a line telling it not to fetch anything for a document
 * of slides.
 *
 * So the address rides in the first screenful, where an agent that skims still
 * sees it. The advice further down is unchanged and still right: most
 * documents need nothing fetched. Knowing WHERE the answer is costs one line;
 * not knowing cost ten requests.
 */
describe('the full reference is named before the brief asks for anything', () => {
  it('names /docs in the first 600 bytes', async () => {
    const s = await start();
    const text = await (await startBrief(request(s.startPath), params(s.id))).text();
    expect(text.slice(0, 600)).toContain('/docs');
  });

  /**
   * And it must not FORBID the fetch, which is a different thing from saying
   * one is usually unnecessary. "For a document of prose, slides or sections,
   * do not fetch anything" is a prohibition, and a prohibition does not stop an
   * agent needing something — it stops it ASKING. Measured: told that, and then
   * wanting the component list for a deck, Claude Code improvised nine invented
   * endpoints instead of opening the page named a few lines above.
   *
   * The identical mistake, in the identical words, was already found and fixed
   * in the plugins prompt this same day ("use them rather than fetching
   * documentation"). One twin got fixed; this is the other.
   */
  it('says most documents need no fetch WITHOUT forbidding one', async () => {
    const s = await start();
    const text = await (await startBrief(request(s.startPath), params(s.id))).text();
    expect(text).not.toMatch(/do not fetch|don't fetch|never fetch|no need to fetch anything/i);
    // The advice survives — it is the absolutism that goes.
    expect(text).toMatch(/enough|covered|without fetching|nothing to fetch/i);
  });
});
