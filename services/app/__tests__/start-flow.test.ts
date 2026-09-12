/**
 * POST /api/start — the home page's "hand this to your agent" button. The
 * magic moment depends on all of this being true at once: a real document
 * exists, the paste-able instruction names it, and the very first agent edit
 * is an ordinary protocol edit.
 *
 * WHAT THIS ROUTE MUST NOT DO is half of the contract now: it mints nothing,
 * hands out no credential and sets no agent cookie. The afbin CLI's browser
 * approval is the only door to a credential in the product, so this response
 * is the same for a signed-in and a signed-out caller.
 */
import { describe, expect, it } from 'vitest';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as artifactPage, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';

import { existingPaste } from '@/lib/agent-copy';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Start { id: string; url: string; prompt: string; edit_id: string }

const start = async (opts: Parameters<typeof request>[1] = {}): Promise<Start> =>
  (await (await startRoute(request('/api/start', { method: 'POST', ...opts }))).json()) as Start;

describe('POST /api/start', () => {
  it('returns a real live document and the ONE tokenless paste — no credential, no cookie', async () => {
    const res = await startRoute(request('/api/start', { method: 'POST' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Start & Record<string, unknown>;

    // One identifier, minted at file-id shape: 6 chars of mixed-case alnum.
    expect(body.id).toMatch(/^[a-zA-Z0-9]{6}$/);
    expect(body).not.toHaveProperty('slug');
    expect(body.url).toBe(`${BASE}/a/${body.id}`);
    expect(body.edit_id).toMatch(/^[a-f0-9]{32}$/);

    // The response is exactly the four fields, and nothing that smells of a credential.
    expect(Object.keys(body).sort()).toEqual(['edit_id', 'id', 'prompt', 'url']);
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('expiresAt');
    expect(JSON.stringify(body)).not.toContain('mx_');
    expect(res.headers.get('set-cookie')).toBeNull();

    expect(body.prompt).toBe(existingPaste(BASE, body.id));
    expect(body.prompt).toContain('afbin help');
    expect(body.prompt).not.toContain('mx_');
    expect(body.prompt).not.toContain('/tokens/new');
    expect(body.prompt.split('\n')).toHaveLength(1);
    expect(body.prompt.length).toBeLessThan(600); // a line, not an essay
  });

  it('answers a signed-in caller the same body, and stamps the document with the account', async () => {
    const user = await createUser({ email: 'start-owner@example.com' });
    const res = await startRoute(request('/api/start', {
      method: 'POST',
      actor: { credential: 'session', userId: user.id, email: 'start-owner@example.com', emailVerified: true },
    }));
    const body = (await res.json()) as Start & Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['edit_id', 'id', 'prompt', 'url']);
    expect(body.prompt).toBe(existingPaste(BASE, body.id));
    expect(body.prompt).not.toContain('mx_');
    expect(body.prompt).not.toContain('/tokens/new');
    expect(res.headers.get('set-cookie')).toBeNull();

    const db = await harness.db();
    const { rows } = await db.query<{ user_id: string | null }>('SELECT user_id FROM artifacts WHERE id = $1', [body.id]);
    expect(rows[0].user_id).toBe(user.id);
  });

  it('a signed-out caller gets an UNOWNED, public document — nobody is handed a capability to it', async () => {
    const body = await start();
    const db = await harness.db();
    const { rows } = await db.query<{ user_id: string | null; token_id: string; visibility: string }>(
      'SELECT user_id, token_id, visibility FROM artifacts WHERE id = $1', [body.id],
    );
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].token_id).toBe('');
    expect(rows[0].visibility).toBe('public');

    // MEASURED, and the honest shape of the signed-out door: the document is
    // public to read and owned by nobody, so a stranger's connection — which
    // is what an afbin anonymous approval is — reads it and cannot write it.
    const stranger = await mintToken('device-approval');
    const read = await artifactPage(request(`/api/artifacts/${body.id}`, { token: stranger.token }), params({ id: body.id }));
    expect(read.status).toBe(200);
    const write = await putArtifact(
      request(`/api/artifacts/${body.id}`, { method: 'PUT', token: stranger.token, json: { markup: '<h1>Not yours</h1>' } }),
      params({ id: body.id }),
    );
    expect(write.status).toBe(404);
  });

  it("the agent's FIRST edit is an ordinary protocol edit and reaches a watching page", async () => {
    // The agent arrives holding its OWN connection (afbin's device approval),
    // and this is the shape that gives it the document: it creates through the
    // same door, so what it writes is what it already reaches.
    const agent = await mintToken('device-approval');
    const doc = await start({ token: agent.token });

    // A reader has the page open before the agent touches it.
    const stream = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
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
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: agent.token, json: { edit_id: doc.edit_id, old_string: 'Waiting for your agent…', new_string: 'Q3 revenue is up 12%.' } }),
      params({ id: doc.id }),
    );
    expect(edit.status).toBe(200);

    await pump;
    void reader.cancel().catch(() => {});
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect((frames[frames.length - 1] as { version: number }).version).toBeGreaterThanOrEqual(2);
    const frame = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(String(frame.source)).toContain('Q3 revenue is up 12%.');
  });

  it('the placeholder is a CENTERED holding state whose cursor really blinks', async () => {
    const agent = await mintToken('device-approval');
    const doc = await start({ token: agent.token });
    const read = await artifactPage(request(`/api/artifacts/${doc.id}`, { token: agent.token }), params({ id: doc.id }));
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
      [doc.id],
    );
    expect(rows[0].meta.compiledCss).toMatch(/@keyframes\s+caret-blink/);
  });

  it('an AGENT that already holds a credential keeps acting as it — one connection, many documents', async () => {
    const agent = await mintToken('device-approval');
    const first = await start({ token: agent.token });
    const second = await start({ token: agent.token });
    expect(second.id).not.toBe(first.id);
    for (const id of [first.id, second.id]) {
      const res = await artifactPage(request(`/api/artifacts/${id}`, { token: agent.token }), params({ id }));
      expect(res.status).toBe(200);
    }
  });

  it('carries no in-process valve — the proxy\'s door is the only count (P2 §H)', async () => {
    // The app handler serves the create; the proxy in front counts it. Driven
    // in-process (no proxy), no call here is ever refused on a budget.
    for (let i = 0; i < 15; i++) {
      const res = await startRoute(request('/api/start', { method: 'POST' }));
      expect(res.status, `start ${i + 1} of 15`).toBe(201);
    }
  });
});
