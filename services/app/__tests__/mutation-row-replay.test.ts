/** The retired named-mutation _row/_value controls now send explicit dataset SQL parameters.
 * Canonical API/browser receipt adaptation remains covered by notification-run-replay.test.ts. */
import { expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken } from './harness';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as mutate } from '@/app/api/artifacts/[id]/mutate/route';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
useAppHarness();
it.each(['rowId', 'value'] as const)(
  'fingerprints explicit %s and replays a committed row update without writing twice',
  async (field) => {
    const owner = await mintAccountToken('row-replay'),
      made = await create(
        request('/api/artifacts', {
          method: 'POST',
          token: owner.token,
          json: {
            dataset: [
              { id: 'one', note: 'old' },
              { id: 'two', note: 'old' },
            ],
            access: 'readwrite',
          },
        }),
      );
    expect(made.status).toBe(201);
    const { id } = await made.json();
    const key = 'mxmx_test_row_replay_once',
      context = { params: Promise.resolve({ id }) };
    const body = {
      sql: 'update public.rows set note=$value where id=$rowId',
      values: { rowId: 'one', value: 'new' },
    };
    const send = (json: object) =>
      mutate(
        request(`/api/artifacts/${id}/mutate`, {
          method: 'POST',
          token: owner.token,
          json,
          headers: { 'Idempotency-Key': key },
        }),
        context,
      );
    const first = await send(body);
    expect(first.status, await first.clone().text()).toBe(200);
    const saved = await first.json();
    expect(await (await send(body)).json()).toEqual(saved);
    const changed = await send({
      ...body,
      values: {
        ...body.values,
        [field]: field === 'rowId' ? 'two' : 'different',
      },
    });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({
      error: 'idempotency_mismatch',
    });
    expect((await getArtifactById(id))!.version).toBe(2);
    expect(await loadDatasetRows((await getArtifactById(id))!)).toEqual([
      { id: 'one', note: 'new' },
      { id: 'two', note: 'old' },
    ]);
  },
);
