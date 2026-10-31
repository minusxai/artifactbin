/**
 * THE COPY-TO-AGENT TEXT, ONE SOURCE. The product is fully behind the afbin CLI: no credential is ever
 * handed to an agent, so there is exactly ONE starter for a handed-over document (`existingPaste`, used
 * by both /api/start and the agent-prompt route) — and no second wording beside it.
 */
import { describe, expect, it } from 'vitest';
import * as agentCopy from '@/lib/agent-copy/agent-copy';
import { existingPaste } from '@/lib/agent-copy';
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { gettingStarted } from '@/lib/agent-copy/getting-started';

const B = 'https://x.test';
const ID = 'ab3cd9';
const STARTER = "Edit my artifact at https://x.test/a/ab3cd9 in place. Use the artifactbin author skill and HTTP: https://x.test/llms.txt. If sign-in is required, reuse an email already provided; otherwise ask the user for their email.\n\nIf the user hasn't specified a task, ask what artifact they'd like to build.";

describe('the tokenless paste', () => {
  it('offers the author skill and HTTP guide without an executable installer',()=>{
    const guide=JSON.stringify(gettingStarted(B));
    expect(guide).toContain(`${B}/skills/artifactbin.zip`);
    expect(guide).not.toMatch(/afbin |@afbin\/cli|\|\s*(?:ba)?sh\b/);
    expect(guide).not.toContain(`${B}/install.sh`);
  });
  it('existing: the link plus how to reach afbin, and never a token', () => {
    expect(existingPaste(B, ID)).toBe(STARTER);
    expect(existingPaste(B, ID)).not.toContain('mx_');
    // `/tokens/new` and any mention of a token at all are banned on this very surface
    // by agent-starter-consistency.test.ts's case (c), over all of them.
  });
  it('links to the shared guide instead of embedding setup and connection instructions', () => {
    expect(existingPaste(B, ID)).toContain('https://x.test/llms.txt');
    expect(existingPaste(B, ID)).not.toMatch(/ensure-node|npx|@afbin\/cli|afbin help|--server|Approve access/);
    const guide = JSON.stringify(gettingStarted(B));
    expect(guide).toContain('Authenticate as the recipient');
  });
  it.each([DEFAULT_SERVER,`${DEFAULT_SERVER}/`,B])('uses the handed-over origin: %s',base=>{
    expect(existingPaste(base,ID)).toContain(`${base.replace(/\/$/,'')}/llms.txt`);
  });
  it('asks what to build only when the user has not supplied a task', () => {
    const prompt = existingPaste('http://127.0.0.1:45407', ID);
    expect(prompt.length).toBeLessThan(350);
    expect(prompt).toContain("\n\nIf the user hasn't specified a task, ask what artifact they'd like to build." );
  });
  it('a trailing slash on the base does not double up', () => {
    expect(existingPaste('https://x.test/', ID)).toBe(STARTER);
  });
  it.each([
    ['doc', 'document'], ['editorial', 'article'], ['deck', 'presentation'],
    ['dashboard', 'dashboard'], ['plan', 'plan'], ['landing', 'landing page'],
    ['scrolly', 'scrollytelling page'], ['app', 'app'],
  ])('names %s in the question for the user', (template, phrase) => {
    const prompt = existingPaste(B, ID, template);
    expect(prompt).not.toContain('Keep template:');
    expect(prompt).toContain('/a/ab3cd9');
    expect(prompt.endsWith(`If the user hasn't specified a task, ask what ${phrase} they'd like to build.`)).toBe(true);
  });
  it('is the module\'s only export — the start-link paste and the claim relay are gone', () => {
    expect(Object.keys(agentCopy)).toEqual(['existingPaste']);
  });
});
