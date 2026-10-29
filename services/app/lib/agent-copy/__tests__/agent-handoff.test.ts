/**
 * WHAT A DOCUMENT HANDS AN AGENT, as structure: the exact words are pinned once, in lib/agent-copy/__tests__/agent-copy and
 * lib/agent-copy/__tests__/agent-starter-consistency; these pin only that the text is a pure function of its origin (a
 * trailing slash changes nothing, every address it names is on that origin) and carries no credential.
 */
import { describe, expect, it } from 'vitest';
import { agentBlurb, agentContract, existingPaste } from '@/lib/agent-copy';

const ORIGINS = ['https://app.example.test', 'http://127.0.0.1:45407', 'https://blog.example.org'];
const addresses = (text: string) => [...text.matchAll(/\bhttps?:\/\/[^\s)]+?(?=[.,]?(?:\s|$))/g)].map((match) => match[0]);

describe('the agent contract', () => {
  it.each(ORIGINS)('is the same text with or without a trailing slash, and names only %s', (origin) => {
    const text = agentContract(origin);
    expect(agentContract(`${origin}/`)).toBe(text);
    expect(text).not.toContain(`${origin}//`);
    const named = addresses(text);
    expect(named.length).toBeGreaterThanOrEqual(3);
    for (const address of named) expect(address === origin || address.startsWith(`${origin}/`), address).toBe(true);
  });

  it('carries no credential', () => {
    expect(agentContract('https://app.example.test')).not.toMatch(/mx_[a-z]|Bearer |[?&](?:token|key)=/);
  });
});

describe('the existing-document paste', () => {
  it.each(ORIGINS)('links the document and the guide on %s, never doubling a slash', (origin) => {
    const text = existingPaste(`${origin}/`, 'Ab12cd');
    expect(text).toBe(existingPaste(origin, 'Ab12cd'));
    expect(text).toContain(`${origin}/a/Ab12cd `);
    for (const address of addresses(text)) expect(address.startsWith(`${origin}/`), address).toBe(true);
    expect(text).not.toMatch(/mx_[a-z]|Bearer |[?&](?:token|key)=/);
  });

  it('asks about an artifact for an unknown or missing template', () => {
    for (const template of [undefined, null, 'nonsense']) expect(existingPaste('https://x.test', 'Ab12cd', template)).toMatch(/ask what artifact they'd like to build\.$/);
  });
});

it('the product blurb is stable', () => {
  expect(agentBlurb()).toBe(agentBlurb());
  expect(agentBlurb()).not.toMatch(/https?:\/\//);
});

describe('deployment setup options', () => {
  it('set the default only for a company deployment, and name its group once setup is complete', async () => {
    const { deploymentSetupOptions } = await import('@/lib/agent-copy/setup-installers');
    const group = { handle: 'acme' } as never;
    expect(deploymentSetupOptions()).toEqual({});
    expect(deploymentSetupOptions({ mode: 'public', setup_complete: true, default_group: group })).toEqual({});
    expect(deploymentSetupOptions({ mode: 'company', setup_complete: false, default_group: group })).toEqual({ setDefault: true });
    expect(deploymentSetupOptions({ mode: 'company', setup_complete: true, default_group: null })).toEqual({ setDefault: true });
    expect(deploymentSetupOptions({ mode: 'company', setup_complete: true, default_group: group })).toEqual({ setDefault: true, groupHandle: 'acme' });
  });
});
