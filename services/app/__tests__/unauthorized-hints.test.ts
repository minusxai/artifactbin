/** Authentication refusals retain the direct HTTP route and never require installing a client. */
import { describe, expect, it } from 'vitest';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { GET as listMine } from '@/app/api/my/tokens/route';

const BASE = 'http://localhost:3000';
const HELP = expect.stringContaining(`${BASE}/llms/http-auth`);

describe('401 bodies', () => {
  /*
   * One case over every door: the three that existed asserted the same HELP
   * constant three times, differing only in which route produced the refusal.
   */
  it('every refusal links HTTP credential recovery without forcing a CLI install or exposing credentials', async () => {
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
      expect(body.help, name).not.toMatch(/npx|install (?:the )?(?:afbin|CLI)/i);
      expect(body.help, name).toContain('refresh');
      expect(JSON.stringify(body), name).not.toContain('/tokens/new');
    }
  });
});
