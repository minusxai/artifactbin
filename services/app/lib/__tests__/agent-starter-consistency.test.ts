/**
 * ONE STARTER, EVERY SURFACE.
 *
 * artifactbin is CLI-only: the afbin CLI's browser approval is the only way any client obtains a
 * credential, so every surface that hands a document — or a refusal — to an agent must say the same
 * three things and no fourth. This file is the guard over ALL of them at once, because the way this
 * rule rots is one surface at a time.
 *
 *   (a) it names `afbin`
 *   (b) it carries the installer, `curl -fsSL <base>/chat/install.sh | sh`, so an agent without the
 *       binary is never stuck
 *   (c) it says nothing about a token, a paste, a claim, a mint, MCP, `/raw` or `/docs/` — the
 *       retired vocabulary, every word of which sends an agent looking for a door that is gone
 *
 * THE ONE EXCEPTION is exact and asserted as such: the skill may tell an agent `never mint or print
 * tokens`, which is a prohibition rather than an offer. It is removed once, by character, before (c)
 * is applied — so the words stay banned everywhere else, including a second copy of that sentence.
 */
import { describe, expect, it } from 'vitest';
import { browserOnlyRefusal } from '@artifactbin/proxy';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { agentContract } from '@/lib/agent-contract';
import { existingPaste } from '@/lib/agent-copy';
import { agentDiscovery, llmsText } from '@/lib/agent-discovery';
import { createArtifact } from '@/lib/artifacts';
import { unauthorized } from '@/lib/http';
import { buildQuickSheet } from '@/lib/skills';
import { createUser } from '@/lib/users';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const INSTALLER = `curl -fsSL ${BASE}/chat/install.sh | sh`;

/** The retired vocabulary. Each of these, in an agent's hands, is a wrong turn. */
const RETIRED = ['token', 'paste', 'claim', 'tokens/new', 'mint', 'MCP', '/raw', '/docs/'];

/** The single sanctioned mention: a prohibition the skill is allowed to spell out, once. */
const ALLOWED_SENTENCE = 'never mint or print tokens';

let seq = 0;
const surfaces = async (): Promise<Array<[name: string, text: string]>> => {
  const started = await (await startRoute(request('/api/start', { method: 'POST' }))).json() as { prompt: string };

  // A fresh account per call: the harness wipes between TESTS, not between
  // calls inside one.
  const email = `starter-consistency-${seq++}@example.com`;
  const user = await createUser({ email });
  const owned = await createArtifact('', user.id, { format: 'markup', source: '<h1>Owned</h1>', content: '<h1>Owned</h1>', meta: {} } as never);
  const actor = { credential: 'session' as const, userId: user.id, email, emailVerified: true };
  const handed = await (await agentPromptRoute(
    request(`/api/my/artifacts/${owned.id}/agent-prompt`, { method: 'POST', actor }),
    { params: Promise.resolve({ id: owned.id }) },
  )).json() as { prompt: string };

  const refused = await (await unauthorized(new Request(`${BASE}/api/artifacts`))).json() as { help: string };

  return [
    ['lib/agent-copy existingPaste', existingPaste(BASE, 'ab3cd9')],
    ['POST /api/start prompt', started.prompt],
    ['POST /api/my/artifacts/:id/agent-prompt prompt', handed.prompt],
    ['skills/artifactbin/SKILL.md', buildQuickSheet(BASE)],
    ['skills/artifactbin/llms.txt', llmsText(BASE)],
    ['lib/agent-discovery meta', agentDiscovery(BASE).instruction],
    ['lib/agent-contract', agentContract(BASE)],
    ['the 401 hint', refused.help],
    ['the proxy\'s browser-only refusal', await browserOnlyRefusal(BASE).text()],
  ];
};

/** (c) is applied to the text with the ONE sanctioned sentence removed — once, exactly. */
const withoutTheException = (text: string): string => text.replace(ALLOWED_SENTENCE, '');

describe('every agent-facing starter says the same thing', () => {
  it('(a) names afbin', async () => {
    for (const [name, text] of await surfaces()) expect(text, name).toContain('afbin');
  });

  it('(b) carries the installer, so an agent without the binary is never stuck', async () => {
    for (const [name, text] of await surfaces()) expect(text, name).toContain(INSTALLER);
  });

  it('(c) names none of the retired vocabulary', async () => {
    const offences: string[] = [];
    for (const [name, text] of await surfaces()) {
      const scanned = withoutTheException(text).toLowerCase();
      for (const word of RETIRED) if (scanned.includes(word.toLowerCase())) offences.push(`${name}: "${word}"`);
    }
    expect(offences).toEqual([]);
  });

  it('the ONE exception is the skill\'s prohibition, spelled exactly and only once', () => {
    const skill = buildQuickSheet(BASE);
    expect(skill.split(ALLOWED_SENTENCE)).toHaveLength(2);
    // And it is a prohibition, not an offer: nothing around it tells an agent where to get one.
    expect(withoutTheException(skill).toLowerCase()).not.toContain('token');
  });

  it('the starter itself is ONE line, and the same one everywhere it is handed over', async () => {
    const all = await surfaces();
    const [, started] = all.find(([name]) => name === 'POST /api/start prompt')!;
    const [, handed] = all.find(([name]) => name.includes('agent-prompt'))!;
    expect(started.split('\n')).toHaveLength(1);
    expect(handed.replace(/\/a\/[A-Za-z0-9]+/, '/a/<id>')).toBe(started.replace(/\/a\/[A-Za-z0-9]+/, '/a/<id>'));
    expect(started.replace(/\/a\/[A-Za-z0-9]+/, '/a/<id>')).toBe(existingPaste(BASE, '<id>'));
  });
});
