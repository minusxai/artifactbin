/**
 * THE TWO WRITE PATHS ARE ONE PIPELINE.
 *
 * A document can be replaced by a bearer agent (PUT /api/artifacts/:id) or by
 * the browser holding a cookie (PUT /api/my/artifacts/:id). Only the credential
 * differs — the validation, the version bump, the ACL rules and the answer are
 * the same act, and they are the same code (lib/artifact-wire).
 *
 * They were written out separately once, and drifted: the browser path stopped
 * answering with `edit_id` and the dataset-refresh `warnings`, so an editor
 * saving through it could not keep writing without a re-read — and nothing
 * failed, because each route was tested only against itself. This file tests
 * them against EACH OTHER, which is the only way that class of drift shows up.
 */
import { describe, expect, it, vi } from 'vitest';
import { PUT as putBearer } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as putBrowser } from '@/app/api/my/artifacts/[id]/route';


import { mintToken } from '@/lib/tokens';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

// The browser route reads auth(); this suite drives the anonymous cookie, so
// there is no account session. The handlers are the real ones.
vi.mock('@/auth', () => ({ auth: async () => null }));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** One document, reachable by both credentials: the token that made it, and a cookie naming it. */
async function subject() {
  const t = await mintToken('parity');
  const made = await (await createArtifact(
    request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>v1</h1>' } }),
  )).json();
  return { token: t.token, cookie: await agentCookie([t.id]), id: made.id as string };
}

describe('the bearer and browser replace paths answer alike', () => {
  it('both return the same FIELDS on a successful replace', async () => {
    const a = await subject();
    const viaBearer = await (await putBearer(
      request(`/api/artifacts/${a.id}`, { method: 'PUT', token: a.token, json: { markup: '<h1>bearer</h1>' } }),
      params({ id: a.id }),
    )).json();

    const b = await subject();
    const viaBrowser = await (await putBrowser(
      request(`/api/my/artifacts/${b.id}`, { method: 'PUT', cookie: b.cookie, json: { markup: '<h1>browser</h1>' } }),
      params({ id: b.id }),
    )).json();

    expect(Object.keys(viaBrowser).sort()).toEqual(Object.keys(viaBearer).sort());
    // Named explicitly, because these two are the ones that went missing and a
    // key-set comparison alone would have agreed if BOTH paths dropped them.
    for (const wire of [viaBearer, viaBrowser]) {
      expect(wire.edit_id, 'a replace must hand back the new head pointer').toEqual(expect.any(String));
      expect(wire.version).toBe(2);
      // Neither path echoes a document it stored verbatim; both must SAY so.
      expect(wire.markup_changed).toBe(false);
      expect(wire.visibility).toBe('public'); // anonymous token ⇒ born public
    }
  });

  it('both reject a stale expectedVersion with the same 409 body', async () => {
    const a = await subject();
    const bearer = await putBearer(
      request(`/api/artifacts/${a.id}`, { method: 'PUT', token: a.token, json: { markup: '<p>x</p>', expectedVersion: 99 } }),
      params({ id: a.id }),
    );
    const b = await subject();
    const browser = await putBrowser(
      request(`/api/my/artifacts/${b.id}`, { method: 'PUT', cookie: b.cookie, json: { markup: '<p>x</p>', expectedVersion: 99 } }),
      params({ id: b.id }),
    );
    expect([bearer.status, browser.status]).toEqual([409, 409]);
    expect(await bearer.json()).toEqual(await browser.json());
  });

  it('both refuse `private` on an anonymous credential — never a silent downgrade', async () => {
    const a = await subject();
    const bearer = await putBearer(
      request(`/api/artifacts/${a.id}`, { method: 'PUT', token: a.token, json: { markup: '<p>x</p>', visibility: 'private' } }),
      params({ id: a.id }),
    );
    const b = await subject();
    const browser = await putBrowser(
      request(`/api/my/artifacts/${b.id}`, { method: 'PUT', cookie: b.cookie, json: { markup: '<p>x</p>', visibility: 'private' } }),
      params({ id: b.id }),
    );
    expect([bearer.status, browser.status]).toEqual([400, 400]);
    expect(await bearer.json()).toEqual({ error: 'private_requires_account' });
    expect(await browser.json()).toEqual({ error: 'private_requires_account' });
  });

  it('both echo a dataset’s WRITE acl, so a caller need not re-read to see it', async () => {
    // The bearer PUT grew this with writable datasets; the browser one did not
    // have it, and neither did the shared pipeline when it first replaced them
    // — a key-set comparison alone would have agreed while BOTH were missing it.
    const mk = async () => {
      const t = await mintToken('ds');
      const made = await (await createArtifact(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { dataset: [{ a: 1 }], access: 'readwrite' } }),
      )).json();
      return { token: t.token, cookie: await agentCookie([t.id]), id: made.id as string };
    };
    const a = await mk();
    const viaBearer = await (await putBearer(
      request(`/api/artifacts/${a.id}`, { method: 'PUT', token: a.token, json: { dataset: [{ a: 2 }] } }),
      params({ id: a.id }),
    )).json();
    const b = await mk();
    const viaBrowser = await (await putBrowser(
      request(`/api/my/artifacts/${b.id}`, { method: 'PUT', cookie: b.cookie, json: { dataset: [{ a: 2 }] } }),
      params({ id: b.id }),
    )).json();
    expect(viaBearer.access).toBe('readwrite');
    expect(viaBrowser.access).toBe('readwrite');
    expect(Object.keys(viaBrowser).sort()).toEqual(Object.keys(viaBearer).sort());
  });

  it('both answer the uniform 404 for a document the credential cannot reach', async () => {
    const mine = await subject();
    const stranger = await subject();
    // stranger's credential, mine's id.
    const bearer = await putBearer(
      request(`/api/artifacts/${mine.id}`, { method: 'PUT', token: stranger.token, json: { markup: '<p>x</p>' } }),
      params({ id: mine.id }),
    );
    const browser = await putBrowser(
      request(`/api/my/artifacts/${mine.id}`, { method: 'PUT', cookie: stranger.cookie, json: { markup: '<p>x</p>' } }),
      params({ id: mine.id }),
    );
    expect([bearer.status, browser.status]).toEqual([404, 404]);
  });
});
