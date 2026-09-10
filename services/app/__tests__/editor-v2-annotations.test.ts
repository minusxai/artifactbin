import { it, expect } from 'vitest';
import { request, useAppHarness } from './harness';
import { mintToken } from '@/lib/tokens';
import { createAnnotationFor } from '@/lib/annotations';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as edit } from '@/app/api/artifacts/[id]/edits/route';
import { GET as read } from '@/app/api/artifacts/[id]/route';
const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const before = '<p id="a">same same</p><p id="b">same same</p>';
const after = '<p id="a">same Xsame</p>';
const operation = {
  id: '12345678-1234-1234-1234-123456789012',
  kind: 'map',
  maps: [
    {
      fromId: 'b',
      toId: 'a',
      fromText: 'same same',
      toText: 'same Xsame',
      segments: [{ from: 5, to: 6, length: 4 }],
    },
  ],
};
it('commits merge source and exact relation together, restores on undo, and preserves independently changed relations', async () => {
  const token = await mintToken('mxmx_test_editor_v2');
  const made = await create(
    request('/api/artifacts', {
      method: 'POST',
      token: token.token,
      json: { markup: before },
    }),
  );
  expect(made.status).toBe(201);
  const doc = await made.json();
  const comment = await createAnnotationFor(
    { tokenId: token.id, userId: null },
    doc.id,
    {
      nodeId: 'b',
      body: 'suffix',
      quote: 'same',
      range: { v: 1, parts: [{ rel: '', start: 5, end: 9, text: 'same' }] },
    },
    { kind: 'human', label: 'Tester', transport: 'browser' },
  );
  expect(comment).toBeTruthy();
  const head = async () => {
    const r = await read(request(`/api/artifacts/${doc.id}`, { token: token.token }), params(doc.id));
    return r.json();
  };
  const change = async (source: string, ops: unknown[], bearer = token.token) => {
    const current = await head();
    return edit(
      request(`/api/artifacts/${doc.id}/edits`, {
        method: 'POST',
        token: bearer,
        json: { edit_id: current.edit_id, source, annotation_ops: ops },
      }),
      params(doc.id),
    );
  };
  const merged = await change(after, [operation]);
  expect(merged.status, await merged.clone().text()).toBe(200);
  let current = await head();
  expect(current.markup).toBe(after);
  expect(current.annotations[0].anchor.key).toBe('a');
  expect(current.annotations[0].range.parts[0]).toMatchObject({
    start: 6,
    end: 10,
  });
  expect((await change(before, [{ id: operation.id, kind: 'undo' }])).status).toBe(200);
  current = await head();
  expect(current.annotations[0].anchor.key).toBe('b');
  expect(current.annotations[0].range.parts[0]).toMatchObject({
    start: 5,
    end: 9,
  });
  expect((await change(after, [{ id: operation.id, kind: 'redo' }])).status).toBe(200);
  const db = await harness.db();
  await db.query('UPDATE annotations SET range=$1 WHERE artifact_id=$2', [
    JSON.stringify({
      v: 1,
      parts: [{ rel: '', start: 0, end: 4, text: 'same' }],
    }),
    doc.id,
  ]);
  expect((await change(before, [{ id: operation.id, kind: 'undo' }])).status).toBe(200);
  current = await head();
  expect(current.annotations[0].anchor.key).toBe('a');
  expect(current.annotations[0].range.parts[0].start).toBe(0);
  const stable = await head();
  expect(
    (
      await change(after, [
        { ...operation, maps: [{ ...operation.maps[0], segments: [{ from: -1, to: 0, length: 4 }] }] },
      ])
    ).status,
  ).toBe(400);
  expect((await change('<script>bad</script>', [operation])).status).toBe(400);
  expect((await change(after, [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', kind: 'undo' }])).status).toBe(409);
  const refused = await head();
  expect(refused.markup).toBe(stable.markup);
  expect(refused.annotations[0].anchor).toEqual(stable.annotations[0].anchor);
  expect(refused.annotations[0].range).toEqual(stable.annotations[0].range);
  const foreign = await mintToken('mxmx_test_other');
  expect((await change(after, [operation], foreign.token)).status).toBe(404);
  expect((await head()).markup).toBe(before);
});
