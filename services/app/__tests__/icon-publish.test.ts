import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { GET as getArtifact } from '@/app/api/artifacts/[id]/route';
import { mintToken } from '@/lib/tokens';
import { observedRequest } from '@/__tests__/conditional-request';

useAppHarness();

describe('Icon publish validation', () => {
  it.each([
    ['name="definitely-not-an-icon"', 'definitely-not-an-icon'],
    ['name="constructor"', 'constructor'],
    ['name=""', 'nonempty'],
    ['', 'nonempty'],
    ['name={42}', 'string'],
    ['name={null}', 'string'],
  ])('rejects <Icon %s> with a located correction', async (attribute, diagnostic) => {
    const token = await mintToken('icon-validation');
    const markup = `<div><Card><Icon ${attribute} /></Card></div>`;
    const response = await createArtifact(request('/api/artifacts', {
      method: 'POST', token: token.token, json: { title: 'Invalid icon', markup },
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid_jsx');
    const detail = body.details.find((entry: { tag?: string }) => entry.tag === 'Icon');
    expect(detail.message).toContain(diagnostic);
    expect(detail.message).toContain('calendar');
    expect(markup.slice(detail.start, detail.end)).toContain('<Icon');
  });

  it('accepts resolver spellings, aliases and an explicit question-mark icon', async () => {
    const token = await mintToken('icon-validation');
    const markup = '<div><Icon name="calendar" /><Icon name="ChartBar" /><Icon name="grid-2x2" /><Icon name="chart_bar" /><Icon name="circle-question-mark" /></div>';
    const response = await createArtifact(request('/api/artifacts', {
      method: 'POST', token: token.token, json: { title: 'Valid icons', markup },
    }));
    expect(response.status, await response.clone().text()).toBe(201);
  });

  it('refuses an invalid update without replacing the published source', async () => {
    const token = await mintToken('icon-validation');
    const markup = '<Icon name="calendar" id="calendar" />';
    const created = await createArtifact(request('/api/artifacts', {
      method: 'POST', token: token.token, json: { title: 'Valid icon', markup },
    }));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const params = { params: Promise.resolve({ id }) };
    await expect(observedRequest(`/api/artifacts/${id}`, {
      method: 'PUT', token: token.token,
      json: { markup: '<Icon name="definitely-not-an-icon" id="calendar" />' },
    })).rejects.toThrow(/invalid_jsx/);
    const read = await getArtifact(request(`/api/artifacts/${id}`, { token: token.token }), params);
    expect(await read.json()).toMatchObject({ markup });
  });
});
