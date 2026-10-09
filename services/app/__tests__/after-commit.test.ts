/**
 * AFTER-COMMIT HOOKS (lib/artifacts/after-commit): what a committed write tells
 * the rest of the system. A listener is background work beside the write — it
 * can fail, and the write it follows has still happened and still answers so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mutateDatasetRoute } from '@/app/api/artifacts/[id]/mutate/route';
import { emitDatasetCommitted, emitHeadCommitted, onDatasetCommitted, onHeadCommitted } from '@/lib/artifacts/after-commit';
import { getArtifactById } from '@/lib/artifacts';
import { mintAccountToken as mintToken, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const disposers: Array<() => void> = [];
afterEach(() => { while (disposers.length) disposers.pop()!(); vi.restoreAllMocks(); });

async function create(token: string, body: Record<string, unknown>) {
  return createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
}

describe('after-commit hooks', () => {
  it('runs every listener synchronously, in order, and a throwing one stops neither the next nor the emitter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    disposers.push(onHeadCommitted(() => { throw new Error('listener down'); }));
    disposers.push(onHeadCommitted((id, _row, change) => { seen.push(`head:${id}:${change?.renderingChanged ? 'rendering' : 'content'}`); }));
    disposers.push(onDatasetCommitted(() => { throw new Error('listener down'); }));
    disposers.push(onDatasetCommitted((id) => { seen.push(`dataset:${id}`); }));
    expect(() => emitHeadCommitted('a1')).not.toThrow();
    expect(() => emitHeadCommitted('a2', undefined, { renderingChanged: true })).not.toThrow();
    expect(() => emitDatasetCommitted('d1')).not.toThrow();
    // Synchronous: every listener has run before the emitter returns.
    expect(seen).toEqual(['head:a1:content', 'head:a2:rendering', 'dataset:d1']);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('stops calling a listener once it is disposed', () => {
    const seen: string[] = [];
    const off = onHeadCommitted((id) => { seen.push(id); });
    emitHeadCommitted('x');
    off();
    emitHeadCommitted('y');
    expect(seen).toEqual(['x']);
  });

  it('a throwing head listener does not fail the publish it follows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const heads: string[] = [];
    disposers.push(onHeadCommitted(() => { throw new Error('warm-up exploded'); }));
    disposers.push(onHeadCommitted((id) => { heads.push(id); }));
    const t = await mintToken('after-commit-head');
    const made = await create(t.token, { title: 'Hooked', markup: '<p>Hello</p>' });
    expect(made.status, await made.clone().text()).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect(heads).toEqual([id]);
    expect((await getArtifactById(id))?.title).toBe('Hooked');
    expect(warn).toHaveBeenCalled();
  });

  it('a throwing dataset listener does not fail the mutation it follows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const datasets: string[] = [];
    disposers.push(onDatasetCommitted(() => { throw new Error('invalidate exploded'); }));
    disposers.push(onDatasetCommitted((id) => { datasets.push(id); }));
    const t = await mintToken('after-commit-dataset');
    const made = await create(t.token, { dataset: [{ choice: 'ramen' }], access: 'readwrite' });
    expect(made.status, await made.clone().text()).toBe(201);
    const { id: ds } = (await made.json()) as { id: string };
    const res = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `insert into public.rows (choice) values ('tacos')` } }), params(ds));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()) as object).toMatchObject({ id: ds, rowCount: 2 });
    expect(datasets).toEqual([ds]);
    expect(warn).toHaveBeenCalled();
  });
});
