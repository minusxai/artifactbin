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
  /*
   * One case over every door: the three that existed asserted the same HELP
   * constant three times, differing only in which route produced the refusal.
   */
  it('every refusal says retry, how to install afbin, and names the one-pager — and offers no credential of its own', async () => {
    const anonymous = await listArtifacts(new Request(`${BASE}/api/artifacts`));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'unauthorized', help: HELP, guide: `${BASE}/llms.txt` });

    const doors: Array<[string, Response]> = [
      // A session-only route, and a bearer that is well-formed but is nobody's.
      ['GET /api/my/tokens', await listMine(new Request(`${BASE}/api/my/tokens`))],
      ['a bad bearer', await listArtifacts(new Request(`${BASE}/api/artifacts`, { headers: { authorization: 'Bearer mx_' + 'x'.repeat(43) } }))],
    ];
    for (const [name, res] of doors) {
      expect(res.status, name).toBe(401);
      const body = await res.json();
      expect(body, name).toMatchObject({ error: 'unauthorized', help: HELP, guide: `${BASE}/llms.txt` });
      expect(body, name).not.toHaveProperty('tokens');
      expect(JSON.stringify(body), name).not.toContain('/tokens/new');
    }
  });
});
