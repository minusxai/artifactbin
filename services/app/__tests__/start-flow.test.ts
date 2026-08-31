/**
 * POST /api/start — the home page's "hand this to your agent" button. The
 * magic moment depends on all of this being true at once: a real document
 * exists, the paste-able instruction carries a WORKING write capability, and
 * the very first agent edit is an ordinary protocol edit.
 */
import { describe, expect, it } from 'vitest';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as claimStart } from '@/app/a/[id]/start/route';
import { AGENT_COOKIE } from '@/lib/agent-session';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as artifactPage } from '@/app/api/artifacts/[id]/route';


import { anonymousPaste } from '@/lib/agent-copy';
import { issueStartHandle } from '@/lib/start-links';
import { DEFAULT_TOKEN_TTL_MS } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Start { id: string; url: string; prompt: string; token: string; edit_id: string; expiresAt: string }

/**
 * Exercise the documented start-link alternative independently of the default
 * paste: issue a handle for the token `/api/start` returned, then spend it the
 * way an agent does.
 */
const agentToken = async (start: Start): Promise<string> => {
  const k = await issueStartHandle(start.id, start.token);
  const res = await claimStart(request(`/a/${start.id}/start?k=${k}`, { method: 'POST' }), params({ id: start.id }));
  return (await res.text()).match(/mx_[A-Za-z0-9_-]+/)![0];
};

/** The agent-session cookie the start response set, as a request header value. */
const cookieOf = (res: Response): string => {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${AGENT_COOKIE}=([^;]+)`).exec(raw);
  return m ? `${AGENT_COOKIE}=${m[1]}` : '';
};

describe('POST /api/start', () => {
  it('returns a real live document plus a paste-able instruction containing the capability', async () => {
    const res = await startRoute(request('/api/start', { method: 'POST' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Start;

    // One identifier, minted at file-id shape: 6 chars of mixed-case alnum.
    expect(body.id).toMatch(/^[a-zA-Z0-9]{6}$/);
    expect(body).not.toHaveProperty('slug');
    expect(body.url).toBe(`${BASE}/a/${body.id}`);
    expect(body.edit_id).toMatch(/^[a-f0-9]{32}$/);
    expect(Math.abs(Date.parse(body.expiresAt) - (Date.now() + DEFAULT_TOKEN_TTL_MS))).toBeLessThan(5_000);
    expect(body.token).toMatch(/^mx_/);
    expect(res.headers.get('set-cookie') ?? '').toContain('HttpOnly');
    expect(body.prompt).toBe(anonymousPaste(BASE, body.id, body.token));
    expect(body.prompt).toContain(body.token);
    expect(body.prompt.split('\n')).toHaveLength(1);
    expect(body.prompt.length).toBeLessThan(160);

    // The document is readable with the token the START LINK hands the agent.
    const read = await artifactPage(request(`/api/artifacts/${body.id}`, { token: await agentToken(body) }), params({ id: body.id }));
    expect(read.status).toBe(200);
    expect((await read.json()).format).toBe('markup');
  });

  it("the agent's FIRST edit is an ordinary protocol edit and reaches a watching page", async () => {
    const start = (await (await startRoute(request('/api/start', { method: 'POST' }))).json()) as Start;
    const token = await agentToken(start);

    // A reader has the page open before the agent touches it.
    const stream = await eventsRoute(request(`/a/${start.id}/events`), params({ id: start.id }));
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const frames: Record<string, unknown>[] = [];
    const pump = (async () => {
      const deadline = Date.now() + 3000;
      while (frames.length < 2 && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
        ]);
        if (chunk.done || !chunk.value) break;
        for (const line of decoder.decode(chunk.value, { stream: true }).split('\n\n')) {
          if (line.startsWith('data: ')) frames.push(JSON.parse(line.slice(6)));
        }
      }
    })();

    const edit = await editRoute(
      request(`/api/artifacts/${start.id}/edits`, { method: 'POST', token: token, json: { edit_id: start.edit_id, old_string: 'Waiting for your agent…', new_string: 'Q3 revenue is up 12%.' } }),
      params({ id: start.id }),
    );
    expect(edit.status).toBe(200);

    await pump;
    void reader.cancel().catch(() => {});
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect((frames[frames.length - 1] as { version: number }).version).toBeGreaterThanOrEqual(2);
    const frame = await (await frameRoute(request(`/a/${start.id}/events/frame`), params({ id: start.id }))).json();
    expect(String(frame.source)).toContain('Q3 revenue is up 12%.');
  });

  it('the placeholder is a CENTERED holding state whose cursor really blinks', async () => {
    const start = (await (await startRoute(request('/api/start', { method: 'POST' }))).json()) as Start;
    const read = await artifactPage(request(`/api/artifacts/${start.id}`, { token: await agentToken(start) }), params({ id: start.id }));
    const { markup } = (await read.json()) as { markup: string };

    // Still an ordinary anchor: the agent's first edit targets this text (above).
    expect(markup).toContain('Waiting for your agent…');
    // A holding state, not a bare heading in the top-left corner.
    expect(markup).toContain('items-center');
    expect(markup).toContain('justify-center');

    // The blink has to survive the Tailwind compile — an animate-* class whose
    // keyframes never made it into the stored CSS is a dead cursor on the page.
    const db = await harness.db();
    const { rows } = await db.query<{ meta: { compiledCss?: string } }>(
      `SELECT meta FROM artifacts WHERE id = $1`,
      [start.id],
    );
    expect(rows[0].meta.compiledCss).toMatch(/@keyframes\s+caret-blink/);
  });

  it('REUSES the token an AGENT presents, instead of minting a second', async () => {
    const firstRes = await startRoute(request('/api/start', { method: 'POST' }));
    const first = (await firstRes.json()) as Start;
    const token = await agentToken(first);

    const second = (await (await startRoute(request('/api/start', { method: 'POST', token: token }))).json()) as Start;
    expect(second.id).not.toBe(first.id);
    // One token, both documents: an agent that already holds a credential
    // keeps acting as it, so what it writes joins what it already reaches.
    for (const id of [first.id, second.id]) {
      const res = await artifactPage(request(`/api/artifacts/${id}`, { token: token }), params({ id }));
      expect(res.status).toBe(200);
    }
  });

  it('gives a BROWSER a fresh token per document, and its cookie carries them all', async () => {
    const firstRes = await startRoute(request('/api/start', { method: 'POST' }));
    const first = (await firstRes.json()) as Start;
    const cookie = cookieOf(firstRes);
    expect(cookie).not.toBe('');

    // A browser holds token IDS, so there is no plaintext left to hand a second
    // agent — and an anonymous token reaches only what it created, so reusing
    // one would produce a document its own agent could not edit. A fresh token
    // per document is the answer the cookie's LIST was built for.
    const secondRes = await startRoute(request('/api/start', { method: 'POST', cookie: cookie }));
    const second = (await secondRes.json()) as Start;
    expect(second.id).not.toBe(first.id);

    // Each document is reachable by the token its own start link handed out…
    for (const start of [first, second]) {
      const res = await artifactPage(request(`/api/artifacts/${start.id}`, { token: await agentToken(start) }), params({ id: start.id }));
      expect(res.status).toBe(200);
    }
    // …and the browser still edits the LATEST through its cookie.
    const mine = await artifactPage(request(`/api/artifacts/${second.id}`, { cookie: cookieOf(secondRes) }), params({ id: second.id }));
    expect(mine.status).toBe(200);
  });

  it('carries no in-process mint valve — the proxy\'s ANON_MINT door is the only count (P2 §H)', async () => {
    // The app handler serves the mint; the proxy in front counts it. Driven
    // in-process (no proxy), no call here is ever refused on a budget.
    for (let i = 0; i < 15; i++) {
      const res = await startRoute(request('/api/start', { method: 'POST' }));
      expect(res.status, `start ${i + 1} of 15`).toBe(201);
    }
  });
});
