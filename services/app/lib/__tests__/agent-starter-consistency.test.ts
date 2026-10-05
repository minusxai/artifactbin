/** Every discovery surface names npm afbin; CLI starters retain their auth loop,
 * while direct HTTP discovery teaches verified email issuance and graph claims.
 * Retired endpoints/brands remain forbidden on every surface. */
import { describe, expect, it } from 'vitest';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { agentContract } from '@/lib/serving';
import { existingPaste } from '@/lib/serving';
import { agentDiscovery, llmsText } from '@/lib/serving';
import { createArtifact } from '@/lib/artifacts';
import { unauthorized } from '@/lib/http';
import { buildQuickSheet, renderTree, skillTree } from '@/lib/skills';
import { createUser } from '@/lib/accounts';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const INSTALLER = `npx --yes @afbin/cli@latest`;

/** The retired vocabulary. Each of these, in an agent's hands, is a wrong turn. */
const RETIRED = ['paste', 'tokens/new', 'tokens/anonymous', 'MCP', '/raw', '/docs/'];
const CLI_ONLY_RETIRED = ['token','mint','claim'];
const httpDiscovery=(name:string)=>name==='skills/artifactbin/llms.txt'||name==='lib/agent-discovery meta';

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
      for (const word of [...RETIRED,...(httpDiscovery(name)?[]:CLI_ONLY_RETIRED)]) if (scanned.includes(word.toLowerCase())) offences.push(`${name}: "${word}"`);
    }
    expect(offences).toEqual([]);
  });

  it('direct HTTP discovery requires email and teaches the real scoped bearer and graph contract',()=>{
    const guide=llmsText(BASE);
    expect(guide).toContain('Direct HTTP clients require email authentication');
    expect(guide).toContain('guest browser approval is CLI-only');
    expect(guide).toContain('/api/authentication/token');
    expect(guide).toContain('Only verified email account sessions qualify');
    expect(guide).toContain('Authorization: Bearer <access_token>');
    expect(guide).toContain('patch.claims');
  });

  it('the ONE exception is the skill\'s prohibition, spelled exactly and only once', () => {
    const skill = buildQuickSheet(BASE);
    expect(skill.split(ALLOWED_SENTENCE)).toHaveLength(2);
    // And it is a prohibition, not an offer: nothing around it tells an agent where to get one.
    expect(withoutTheException(skill).toLowerCase()).not.toContain('token');
  });

  it('the starter includes the editable brief and is identical everywhere it is handed over', async () => {
    const all = await surfaces();
    const [, started] = all.find(([name]) => name === 'POST /api/start prompt')!;
    const [, handed] = all.find(([name]) => name.includes('agent-prompt'))!;
    expect(started).toContain("\n\n---\n\nLet's build an artifact for " );
    expect(handed.replace(/\/a\/[A-Za-z0-9]+/g, '/a/<id>')).toBe(started.replace(/\/a\/[A-Za-z0-9]+/g, '/a/<id>'));
    expect(started.replace(/\/a\/[A-Za-z0-9]+/g, '/a/<id>')).toBe(existingPaste(BASE, '<id>'));
  });
});

/**
 * The BRIEF and the CONTRACT — the two surfaces the starter sends an agent to next. Four
 * single-thought files used to assert one paragraph of this each (`m3-publish-first`,
 * `brief-auth-rule`, `agent-contract`, `publishing-doc-tokens`); they are one rule about one pair
 * of functions, so they are one describe. Their byte caps went to skill-tree.test.ts's single
 * sweep, and their retired-vocabulary lines to case (c) above and to retired-surfaces.test.ts.
 */
describe('what the brief and the contract teach next', () => {
  const brief = renderTree(skillTree(), 'https://artifactbin.dev').find(({ file }) => file.path === 'artifactbin/SKILL.md')!.text;

  it('teaches automatic sign-in, browser approval and the private configuration location, without a setup step', () => {
    expect(brief).toContain('@afbin/cli@latest <command>');
    expect(brief).toContain('references/npm-local.md');
    expect(brief).toMatch(/automatic|authenticates itself|signs you in/i);
    expect(brief).toContain('~/.artifactbin/hosts/<origin-id>/credentials.env');
    expect(brief).toContain('browser approval');
    expect(brief).toContain('--yes');
    expect(brief).toMatch(/never.*mint/i);
  });

  it('teaches reuse before new publication and preserves identity during recovery', () => {
    const sheet = buildQuickSheet('https://example.test');
    expect(sheet.indexOf('For a supplied artifact')).toBeLessThan(sheet.indexOf('For a new artifact'));
    expect(sheet).toContain('Preserve its identity');
    expect(sheet).toContain('after an uncertain write repeat the same command and arguments');
    expect(sheet).toContain('references/markup.md');
    expect(sheet).toContain('references/design.md');
  });

  it('spells local help, origin-scoped browser setup and the current private config directory', () => {
    const contract = agentContract('https://example.test');
    expect(contract).toContain('@afbin/cli@latest auth --server https://example.test');
    expect(contract).toContain('~/.artifactbin/hosts/<origin-id>/credentials.env');
    expect(contract).toContain('--yes --json');
    expect(contract).toContain('browser approval');
  });
});
