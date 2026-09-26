import {observedRequest} from '@/__tests__/conditional-request';
import {observedTextBody} from './prepared-document';
/** Creates elide unchanged markup; operation commits return the canonical graph and source. */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as editArtifact } from '@/app/api/artifacts/[id]/edits/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();



const SECRET = 'test-secret';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

let token: string;
const CANONICAL = '<div className="p-8" id="root"><h1 className="text-4xl font-bold" id="heading">Title</h1><p id="body">Body copy.</p></div>';
/** HTML's parser closes the <p> at the <div>, so the door rewrites it — the case the echo exists for. */
const NEEDS_REWRITE = '<div className="p-8"><p className="lead"><div>Block inside a paragraph</div></p></div>';

beforeEach(async () => {
  const minted = await (await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 'echo' }, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }))).json();
  token = minted.token;
});

async function create(markup: string) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { markup } }));
  return { status: res.status, body: await res.json() };
}

describe('the write echo is present only when it is news', () => {
  it('a create whose markup stored unchanged answers markup_changed:false and NO markup', async () => {
    const { status, body } = await create(CANONICAL);
    expect(status).toBe(201);
    expect(body.markup_changed).toBe(false);
    expect(body.markup).toBeUndefined();
    // Everything the agent needs to keep working still rides along.
    expect(body.id).toMatch(/^[A-Za-z0-9]{6,12}$/);
    expect(body.edit_id).toEqual(expect.any(String));
    expect(body.url).toContain('/a/');
  });

  it('a create the door REWROTE echoes the canonical markup and says so', async () => {
    const { status, body } = await create(NEEDS_REWRITE);
    expect(status).toBe(201);
    expect(body.markup_changed).toBe(true);
    expect(body.markup).toContain('<div');
    expect(body.markup).not.toBe(NEEDS_REWRITE);
  });

  it('an operation replacement returns the canonical authoring snapshot', async () => {
    const { body: made } = await create(CANONICAL);
    const unchanged = await (await putArtifact(await observedRequest(`/api/artifacts/${made.id}`, { method: 'PUT', token: token, json: { markup: CANONICAL } }), params({ id: made.id }))).json();
    expect(unchanged.document.kind).toBe('graph');
    expect(unchanged.markup).toBe(CANONICAL);
    expect(unchanged.edit_id).toEqual(expect.any(String));

    const rewritten = await (await putArtifact(await observedRequest(`/api/artifacts/${made.id}`, { method: 'PUT', token: token, json: { markup: NEEDS_REWRITE } }), params({ id: made.id }))).json();
    expect(rewritten.document.kind).toBe('graph');
    expect(rewritten.markup).toEqual(expect.any(String));
  });

  it('/edits ALWAYS echoes: its caller sent a splice, not a document', async () => {
    const { body: made } = await create(CANONICAL);
    const res = await editArtifact(
      request(`/api/artifacts/${made.id}/edits`, { method: 'POST', token: token, json: await observedTextBody(made.id,'Body copy.','Different copy.') }),
      params({ id: made.id }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.markup).toContain('Different copy.');
  });

  it('a write that carried no markup at all is unaffected — nothing to compare against', async () => {
    const { body: made } = await create(CANONICAL);
    const res = await putArtifact(
      await observedRequest(`/api/artifacts/${made.id}`, { method: 'PUT', token: token, json: { markup: CANONICAL, title: 'Named' } }),
      params({ id: made.id }),
    );
    const body = await res.json();
    expect(body.title ?? 'Named').toBeTruthy();
    expect(body.document.kind).toBe('graph');
  });
});
