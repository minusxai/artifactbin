/**
 * DISCOVER: the moment an agent is refused is the moment it needs the pointer. Every `401 unauthorized` JSON
 * body carries `help` — telling the agent to just retry, since afbin authenticates itself, and how to install
 * it if it is missing — and `guide` (the one-pager), on the request base. No credential door of any kind:
 * there is nothing to hand out and nowhere to get one but the CLI.
 */
import { describe, expect, it } from 'vitest';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { GET as listMine } from '@/app/api/my/tokens/route';

const BASE = 'http://localhost:3000';
const HELP = `Retry — afbin authenticates itself when it needs the server; there is nothing to set up. Install it if it is missing: curl -fsSL ${BASE}/chat/install.sh | sh`;

describe('401 bodies', () => {
  it('GET /api/artifacts without a credential says retry, how to install afbin, and names the one-pager', async () => {
    const res = await listArtifacts(new Request(`${BASE}/api/artifacts`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized', help: HELP, guide: `${BASE}/llms.txt` });
  });
  it('a session-only route says the same and offers no credential of its own', async () => {
    const res = await listMine(new Request(`${BASE}/api/my/tokens`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'unauthorized', help: HELP, guide: `${BASE}/llms.txt` });
    expect(body).not.toHaveProperty('tokens');
  });
  it('a bad bearer is refused with the same hints and no credential door', async () => {
    const res = await listArtifacts(new Request(`${BASE}/api/artifacts`, { headers: { authorization: 'Bearer mx_' + 'x'.repeat(43) } }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ help: HELP });
    expect(body).not.toHaveProperty('tokens');
    expect(JSON.stringify(body)).not.toContain('/tokens/new');
  });
});
