import {observedSourceBody,observedTextBody} from './prepared-document';
/**
 * POST /api/start — the home page's "hand this to your agent" button. The
 * magic moment depends on all of this being true at once: a real document
 * exists, the paste-able instruction names it, and the very first agent edit
 * is an ordinary protocol edit.
 *
 * The response body exposes no credential. An email account owns the
 * document; the CLI separately needs explicit browser approval.
 */
import { describe, expect, it } from 'vitest';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as artifactPage } from '@/app/api/artifacts/[id]/route';

import { prepareBlankReport } from '@/solid/lib/blank-report';
import { getArtifactById } from '@/lib/artifacts';
import { existingPaste } from '@/lib/serving';
import { mintToken as mintRawToken } from '@/lib/accounts';
import { createUser } from '@/lib/accounts';
import { POST as createBrowserArtifact } from '@/app/api/my/artifacts/route';
import { artifactStarter } from '@/lib/workspace/artifact-starters';
import { isStartPlaceholder } from '@artifactbin/contracts';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Start { id: string; url: string; prompt: string; edit_id: string }

const mintToken = async (name: string) => {
  const user = await createUser({ email: `mxmx_test_start_${crypto.randomUUID()}@example.com` });
  return { ...await mintRawToken(name, user.id), userId: user.id, email: user.email! };
};

const start = async (opts: Parameters<typeof request>[1] = {}): Promise<Start> =>
  (await (await startRoute(request('/api/start', { method: 'POST', ...opts }))).json()) as Start;

describe('POST /api/start', () => {
  it('creates private typed starters through the browser API without saving setup UI', async () => {
    const user = await createUser({ email: 'mxmx_test_starters@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: user.email!, emailVerified: true };
    for (const template of ['doc', 'deck'] as const) {
      const response = await createBrowserArtifact(request('/api/my/artifacts', { method: 'POST', actor, json: artifactStarter(template) }));
      expect(response.status).toBe(201);
      const { id } = await response.json();
      const row = (await getArtifactById(id))!;
      expect(row.meta.template).toBe(template);
      expect(row.user_id).toBe(user.id);
      expect(row.visibility).toBe('private');
      expect(row.source).not.toContain('Copy agent instructions');
      expect(row.source).not.toContain('Waiting for your agent');
      expect(isStartPlaceholder(row.source, row.version)).toBe(template !== 'doc');
      if (template === 'doc') {
        expect(row.meta.theme).toBe('meridian');
        expect(row.source).toContain('data-placeholder="Headline"');
        expect(row.source).toContain('<Markdown id="body"');
        expect(row.source).toContain('{``}</Markdown>');
        expect(row.source).not.toContain('<p id="body"');
        expect(row.source).not.toContain('>Headline<');
      }
    }
  });

  it('creates an editable blank report only when explicitly requested, retaining owner and privacy', async () => {
    const user = await createUser({ email: 'blank-owner@example.com' });
    const res = await startRoute(request('/api/start?mode=blank', { method: 'POST', actor: { credential: 'session', userId: user.id, email: user.email!, emailVerified: true } }));
    expect(res.status).toBe(201);
    const body = await res.json() as Start;
    const db = await harness.db();
    const { rows } = await db.query<{ source: string; user_id: string; visibility: string }>('SELECT source, user_id, visibility FROM artifacts WHERE id = $1', [body.id]);
    const source = (await getArtifactById(body.id))!.source;
    expect(source).toContain('Untitled report');
    expect(source).toContain('Start writing here.');
    expect(source).toContain('<Markdown');
    expect(source).not.toContain('Waiting for your agent');
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].visibility).toBe('private');
  });

  it('converts the same starter, persists edits, and refuses a stale conversion after an agent writes', async () => {
    const agent = await mintToken('device-approval');
    const doc = await start({ token: agent.token });
    const before = (await getArtifactById(doc.id))!;
    if (before.document?.kind !== 'graph') throw new Error('Missing graph');
    const blank = prepareBlankReport({ ...before, document: before.document, markup: before.source, theme: null }, before.edit_id);
    const saved = await editRoute(request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: agent.token, json: blank }), params({ id: doc.id }));
    expect(saved.status).toBe(200);
    const typed = await editRoute(request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: agent.token, json: await observedTextBody(doc.id, 'Start writing here.', 'My first report.') }), params({ id: doc.id }));
    expect(typed.status).toBe(200);
    const read = await artifactPage(request(`/api/artifacts/${doc.id}`, { token: agent.token }), params({ id: doc.id }));
    expect((await read.json()).markup).toContain('My first report.');
    const conflicting = await start({ token: agent.token });
    const old = (await getArtifactById(conflicting.id))!;
    if (old.document?.kind !== 'graph') throw new Error('Missing graph');
    const oldDocument = old.document;
    const stale = prepareBlankReport({ ...old, document: oldDocument, markup: old.source, theme: null }, old.edit_id);
    const agentWrite = await editRoute(request(`/api/artifacts/${conflicting.id}/edits`, { method: 'POST', token: agent.token, json: await observedSourceBody(conflicting.id, '<h1>Agent work</h1>') }), params({ id: conflicting.id }));
    expect(agentWrite.status).toBe(200);
    const rejected = await editRoute(request(`/api/artifacts/${conflicting.id}/edits`, { method: 'POST', token: agent.token, json: stale }), params({ id: conflicting.id }));
    expect(rejected.status).toBe(409);
    expect((await getArtifactById(conflicting.id))!.source).toContain('Agent work');
    expect(() => prepareBlankReport({ ...old, document: oldDocument, markup: old.source, theme: null }, 'different')).toThrow();
  });

  it('returns a live document and tokenless instructions for an email account', async () => {
    const account = await createUser({ email: 'mxmx_test_start_prompt@example.com' });
    const res = await startRoute(request('/api/start', { method: 'POST', actor: { credential: 'session', userId: account.id, email: account.email! } }));
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
    expect(body.prompt).toContain(`${BASE}/getting-started.md`);
    expect(body.prompt).not.toContain('npx --yes');
    expect(body.prompt).not.toContain('mx_');
    expect(body.prompt).not.toContain('/tokens/new');
    expect(body.prompt).toContain("\n\n---\n\nLet's build an artifact for " );
    expect(body.prompt.length).toBeLessThan(600); // instructions plus a short editable brief
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

  it('refuses a signed-out starter without creating an artifact or cookie', async () => {
    const response = await startRoute(request('/api/start', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await (await harness.db()).query('SELECT id FROM artifacts')).rows).toHaveLength(0);
  });

  it("the agent's FIRST edit is an ordinary protocol edit and reaches a watching page", async () => {
    // The agent arrives holding its OWN connection (afbin's device approval),
    // and this is the shape that gives it the document: it creates through the
    // same door, so what it writes is what it already reaches.
    const agent = await mintToken('device-approval');
    const doc = await start({ token: agent.token });

    // A reader has the page open before the agent touches it.
    const stream = await eventsRoute(request(`/a/${doc.id}/events`, { actor: { credential: 'session', userId: agent.userId!, email: agent.email } }), params({ id: doc.id }));
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
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: agent.token, json: await observedTextBody(doc.id,'Waiting for your agent…','Q3 revenue is up 12%.') }),
      params({ id: doc.id }),
    );
    expect(edit.status).toBe(200);

    await pump;
    void reader.cancel().catch(() => {});
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect((frames[frames.length - 1] as { version: number }).version).toBeGreaterThanOrEqual(2);
    const frame = await (await frameRoute(request(`/a/${doc.id}/events/frame`, { actor: { credential: 'session', userId: agent.userId, email: agent.email } }), params({ id: doc.id }))).json();
    expect(String(frame.source)).toContain('Q3 revenue is up 12%.');
  });

  it('the placeholder is a CENTERED holding state whose cursor really blinks', async () => {
    const agent = await mintToken('device-approval');
    const doc = await start({ token: agent.token });
    const read = await artifactPage(request(`/api/artifacts/${doc.id}`, { token: agent.token }), params({ id: doc.id }));
    const { markup } = (await read.json()) as { markup: string };

    // Still an ordinary anchor: the agent's first edit targets this text (above).
    expect(markup).toContain('Waiting for your agent…');
    // A fetcher that reduces the page to its text (no head tags, no comments) still learns the way on.
    expect(markup).toContain('Agents: edit this document with the afbin CLI or direct HTTP API — read /llms.txt on this site for both paths.');
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

  // Its in-process valve (none: the proxy's door is the only count) is users.test.ts 'carries no in-process valve'.
});
