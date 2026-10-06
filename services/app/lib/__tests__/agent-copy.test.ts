/**
 * THE COPY-TO-AGENT TEXT, ONE SOURCE. The product is fully behind the afbin CLI: no credential is ever
 * handed to an agent, so there is exactly ONE starter for a handed-over document (`existingPaste`, used
 * by both /api/start and the agent-prompt route) — and no second wording beside it.
 */
import { describe, expect, it } from 'vitest';
import * as agentCopy from '@/lib/serving/agent-copy';
import { existingPaste } from '@/lib/serving';
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { gettingStartedMarkdown } from '@/lib/serving/getting-started';

const B = 'https://x.test';
const ID = 'ab3cd9';
const STARTER = "Edit my artifact at https://x.test/a/ab3cd9 in place.\n\nGetting started with afbin: https://x.test/getting-started.md\n\n---\n\nLet's build an artifact for ";

describe('the tokenless paste', () => {
  it('existing: the link plus how to reach afbin, and never a token', () => {
    expect(existingPaste(B, ID)).toBe(STARTER);
    expect(existingPaste(B, ID)).not.toContain('mx_');
    // `/tokens/new` and any mention of a token at all are banned on this very surface
    // by agent-starter-consistency.test.ts's case (c), over all of them.
  });
  it('links to the shared guide instead of embedding setup and connection instructions', () => {
    expect(existingPaste(B, ID)).toContain('https://x.test/getting-started.md');
    expect(existingPaste(B, ID)).not.toMatch(/ensure-node|npx|@afbin\/cli|afbin help|--server|Approve access/);
    const guide = gettingStartedMarkdown(B);
    expect(guide).toContain('If afbin is not installed');
    expect(guide).toContain('Run afbin help to discover everything you can do');
    expect(guide).toContain('Approve access in your browser');
    expect(guide).toContain("afbin auth 'ARTIFACT_URL' --server 'https://x.test'");
  });
  it.each(['https://x.test', 'http://127.0.0.1:45407/'])('selects the handed-over server for every remote command: %s', (base) => {
    expect(gettingStartedMarkdown(base)).toContain(`Pass --server ${base.replace(/\/$/, '')} to every afbin server command`);
    expect(existingPaste(base, ID)).toContain(`${base.replace(/\/$/, '')}/getting-started.md`);
  });
  it.each([DEFAULT_SERVER, `${DEFAULT_SERVER}/`])('keeps the handoff short on the host a fresh CLI already defaults to: %s', (base) => {
    expect(existingPaste(base, ID)).not.toContain('--server');
    expect(existingPaste(base, ID)).toContain(`${DEFAULT_SERVER}/a/${ID}`);
    expect(gettingStartedMarkdown(base)).toContain('no --server flag is needed');
  });
  it('keeps the handoff concise and leaves a separated brief for the user', () => {
    const prompt = existingPaste('http://127.0.0.1:45407', ID);
    expect(prompt.length).toBeLessThan(250);
    expect(prompt).toContain("\n\n---\n\nLet's build an artifact for " );
  });
  it('a trailing slash on the base does not double up', () => {
    expect(existingPaste('https://x.test/', ID)).toBe(STARTER);
  });
  it.each([
    ['doc', 'a document'], ['editorial', 'an article'], ['deck', 'a presentation'],
    ['dashboard', 'a dashboard'], ['plan', 'a plan'], ['landing', 'a landing page'],
    ['scrolly', 'a scrollytelling page'], ['app', 'an app'],
  ])('names %s in the template instruction and editable brief', (template, phrase) => {
    const prompt = existingPaste(B, ID, template);
    expect(prompt).toContain(`template: ${template}`);
    expect(prompt).toContain('/a/ab3cd9');
    expect(prompt.endsWith(`Let's build ${phrase} for `)).toBe(true);
  });
  it('is the module\'s only export — the start-link paste and the claim relay are gone', () => {
    expect(Object.keys(agentCopy)).toEqual(['existingPaste']);
  });
});
