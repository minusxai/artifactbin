/**
 * A COMMENT IS A RELATION, AND NEVER AN EDIT — through every action there is.
 *
 * `node-project.test.ts` proves it for creating and deleting an annotation.
 * The browser gate that used to run beside it (scripts/gate-node-identity.mjs)
 * also drove reply, resolve and reopen against a built server, and asserted the
 * same invariant after each one; nothing else did. It needed no browser — it
 * was `fetch` and string assertions over these very routes — so the assertion
 * lives here instead and the gate is gone.
 *
 * The invariant: an annotation action leaves `edit_id`, the markup and the
 * document's history byte-identical. A comment that quietly rewrote the source
 * would move the head every reader and every agent is editing against.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request, agentCookie } from './harness';
import { mintToken } from '@/lib/tokens';
import { getDb } from '@/lib/db';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as getRoute } from '@/app/api/artifacts/[id]/route';
import { POST as commentRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { POST as commentActionRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function history(id: string) {
  const db = await getDb();
  return {
    edits: (await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq', [id])).rows,
    versions: (await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version', [id])).rows,
  };
}

describe('annotation actions are relations, not edits', () => {
  it('reply, resolve and reopen each leave edit_id, markup and history untouched', async () => {
    const token = await mintToken('comment-actions');
    const made = await createRoute(request('/api/artifacts', {
      method: 'POST',
      token: token.token,
      json: { markup: '<main id="root"><Card id="card">Hello</Card><p id="other">Old</p></main>' },
    }));
    expect(made.status, await made.clone().text()).toBe(201);
    const doc = await made.json();
    const read = async () => (await getRoute(request(`/api/artifacts/${doc.id}`, { token: token.token }), params(doc.id))).json();

    const cookie = await agentCookie([token.id]);
    const commented = await commentRoute(request(`/api/my/artifacts/${doc.id}/annotations`, {
      method: 'POST', cookie, json: { node_id: 'card', body: 'Keep this card' },
    }), params(doc.id));
    expect(commented.status, await commented.clone().text()).toBe(201);
    const annotation = await commented.json();

    const base = await read();
    const before = await history(doc.id);
    for (const action of [{ reply: 'Moved successfully' }, { resolve: true }, { reopen: true }]) {
      const response = await commentActionRoute(
        request(`/api/my/artifacts/${doc.id}/annotations/${annotation.id}`, { method: 'POST', cookie, json: action }),
        { params: Promise.resolve({ id: doc.id, annId: annotation.id }) },
      );
      expect(response.status, `${Object.keys(action)[0]}: ${await response.clone().text()}`).toBeLessThan(300);
      const head = await read();
      expect(head.edit_id, `${Object.keys(action)[0]} moved the head`).toBe(base.edit_id);
      expect(head.markup).toBe(base.markup);
      expect(await history(doc.id)).toEqual(before);
    }
  });
});
