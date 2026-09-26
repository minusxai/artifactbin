/** Create responses teach the Import of the dataset and a query over it, with real columns; the ref field names what to import. */
import { describe, it, expect, beforeEach } from 'vitest';
import { POST as createArtifact } from '@/app/api/artifacts/route';

import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();


let token: string;

beforeEach(async () => {
  token = (await mintToken('hint-test')).token;
});

const create = async (body: Record<string, unknown>) => {
  const res = await createArtifact(new Request('http://localhost:3000/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

describe('creating a dataset returns how to USE it', () => {
  it('hands back the ref form, not just a bare id', async () => {
    const { body } = await create({ title: 'sales', dataset: 'month,revenue\n2026-01,120' });
    expect(body.ref).toBe(`ref:${body.id}`);
  });

  it('includes a ready-to-paste Question using the real column names', async () => {
    const { body } = await create({ title: 'sales', dataset: 'month,revenue\n2026-01,120\n2026-02,150' });
    const usage = body.usage as string;
    // The exact prop names the agent got wrong, bound to this dataset's columns —
    // through a <Query> over the dataset's SQL table, which is how a document reads one.
    expect(usage).toContain(`<Import name="data" src="ref:${body.id}" /><Query name="rows">`);
    expect(usage).toContain('FROM data."rows"');
    expect(usage).not.toMatch(/source=|public\.rows/);
    expect(usage).not.toContain(`ref_${body.id}`);
    expect(usage).toContain('data="$rows"');
    expect(usage).toContain('viz=');
    expect(usage).toContain('vega-lite');
    expect(usage).toContain('month');   // a real field, not a placeholder
    expect(usage).toContain('revenue');
    // What it teaches publishes as it stands: the read example, and the write example of a readwrite dataset.
    const readDoc = await create({ markup: usage });
    expect(readDoc.status, JSON.stringify(readDoc.body)).toBe(201);
    const writable = await create({ title: 'writes', dataset: 'month,revenue\n2026-01,120', access: 'readwrite' });
    const writeExample = (writable.body.usage as string).slice((writable.body.usage as string).lastIndexOf('<Helmet>'));
    const writeDoc = await create({ markup: writeExample });
    expect(writeDoc.status, JSON.stringify(writeDoc.body)).toBe(201);
  });

  it('picks a quantitative field for y and a non-numeric one for x', async () => {
    const { body } = await create({ title: 'x', dataset: 'region,total\nNA,5\nEU,9' });
    expect(body.usage).toContain('"field":"region"');
    expect(body.usage).toContain('"field":"total"');
  });

  it('still returns something useful when there is no numeric column', async () => {
    const { body } = await create({ title: 'names', dataset: 'a,b\nx,y' });
    expect(body.ref).toBe(`ref:${body.id}`);
    expect(typeof body.usage).toBe('string');
    expect(body.usage.length).toBeGreaterThan(0);
  });

  it('does not attach dataset usage to other tiers', async () => {
    const { body } = await create({ title: 'doc', markup: '<div data-design="tw" className="p-4"><h1 className="text-xl">Hi</h1></div>' });
    expect(body.ref).toBeUndefined();
    expect(body.usage).toBeUndefined();
  });
});
