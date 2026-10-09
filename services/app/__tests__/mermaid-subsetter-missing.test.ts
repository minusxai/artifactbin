/**
 * THE SUBSETTER CAN ONLY FAIL HARVESTING (lib/mermaid-images/fonts). Its
 * WebAssembly packages (wawoff2, harfbuzzjs) load on first use, inside the
 * harvest's embedding step, never at import: with one of them missing or
 * broken, the app still imports, serves and verifies, the harvest stores
 * nothing (and retries later without spending the version's attempts), and
 * readers get the engine's page as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserService, SvgHarvestResult } from '@artifactbin/contracts';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { getDb } from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { services, setServices } from '@/lib/platform';
import { mermaidImageKey } from '@/lib/jsx/mermaid-source';
import { runNextMermaidHarvest } from '@/lib/publish/assets/mermaid-harvester';
import { verifyEmbeddedMermaidSvg } from '@/lib/mermaid-images/sanitize';

// The package is there in name only: importing it throws, as a missing or broken install would.
vi.mock('wawoff2', () => { throw new Error('wawoff2 is not installed'); });

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const FLOW = 'flowchart LR\n  a[Request] --> b[Read]';

/** A browser that draws the flowchart as the kit would, in Inter with JetBrains Mono edge labels. */
const browser: BrowserService = {
  render: async () => ({ ok: false, reason: 'unavailable' }),
  async harvestSvg(req): Promise<SvgHarvestResult> {
    const url = new URL(req.url);
    const surface = url.pathname.endsWith('/raw') ? 'document' : 'inline';
    const mode = url.searchParams.get('color') as 'light' | 'dark';
    return { ok: true, loads: [[{
      attributes: {
        'data-mx-mermaid-key': mermaidImageKey(FLOW, mode), 'data-mx-mermaid-palette': 'a'.repeat(32), 'data-mermaid-type': 'flowchart-v2',
        'data-mx-mermaid-metrics': '855.9375,20,-16,646.796875,14,-11', 'data-mx-mermaid-portable': '', 'data-mx-mermaid-faces': `Inter|${surface === 'document' ? 16 : 14}|JetBrains Mono`,
      },
      width: 120, height: 80,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" id="mx-mermaid-1" viewBox="0 0 10 10"><style>#mx-mermaid-1{font-family:Inter,sans-serif}</style><text>Request</text></svg>',
    }]] };
  },
};

let original: BrowserService;
beforeEach(() => { original = services().browser; setServices({ browser }); });
afterEach(() => { setServices({ browser: original }); });

describe('without the font subsetter', () => {
  it('the app still serves, the harvest stores nothing and retries later uncounted, and readers get the engine', async () => {
    const owner = await mintToken('subsetter-missing');
    const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: `<Mermaid title="D" code={${JSON.stringify(FLOW)}} />`, visibility: 'public' } }));
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await created.json()).id as string;

    expect(await runNextMermaidHarvest()).toBe(true);
    const job = (await (await getDb()).query<{ state: string; attempts: number; retry_after: string | null }>('SELECT state,attempts,retry_after FROM mermaid_harvests WHERE artifact_id=$1', [id])).rows[0]!;
    expect(job).toEqual(expect.objectContaining({ state: 'pending', attempts: 0 }));
    expect(job.retry_after).not.toBeNull();
    expect(Number((await (await getDb()).query<{ n: string }>('SELECT count(*) AS n FROM mermaid_images')).rows[0]!.n)).toBe(0);

    const served = await serveArtifact(request(`/a/${id}/raw`), params({ id }));
    expect(served.status).toBe(200);
    const html = await served.text();
    expect(html).not.toContain('/assets/mermaid/');
    expect(html).toContain('id="mx-story-data"');
  });

  it('the stored-drawing gate still answers (it needs no subsetter)', () => {
    expect(verifyEmbeddedMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>')).toBeNull();
  });
});
