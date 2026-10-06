/**
 * The brief (`skills/artifactbin/SKILL.md`) is the ONE file a harness reads on
 * its own: its description is always in context, its body loads on trigger,
 * and the references load only when the body sends the agent there. So the
 * description must be the trigger, the body must carry the example verbatim,
 * and both must fit the caps. The same folder holds `llms.txt` — the served
 * one-pager for an agent that has nothing installed — whose first line is the
 * blurb every discovery surface (the meta tag) repeats.
 */
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { afbinInstallCommand, afbinWindowsInstallCommand } from '@/lib/serving/agent-discovery-tags';
import { gettingStarted, gettingStartedMarkdown } from '@/lib/serving/getting-started';
import { describe, it, expect } from 'vitest';
import { buildQuickSheet, skillExample, skillTree } from '../skills';
import { AGENT_HELP_TITLE, agentBlurb, agentDiscovery, agentDiscoveryHead, llmsText } from '@/lib/serving';

const BASE = 'https://artifactbin.dev';

describe('the brief', () => {
  const brief = skillTree().get('artifactbin/SKILL.md')!;
  const sheet = buildQuickSheet(BASE);

  it('its description is the trigger: links, the CLI and the tasks, within the harness cap', () => {
    expect(brief.description.length).toBeLessThanOrEqual(1024);
    for (const trigger of ['artifactbin.dev', 'afbin', 'publish', 'edit', 'comment', 'query', 'export', 'dashboard', 'deck', 'dataset']) {
      expect(brief.description).toContain(trigger);
    }
    expect(brief.description).toMatch(/^Required for every artifactbin task/);
  });

  it('opens with what artifactbin and an artifact are, then the CLI loop, then the example, then the references', () => {
    const at = (s: string) => { const i = sheet.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i; };
    const order = [at('artifactbin publishes'), at('YAML fence'), at('afbin pull'), at('## Example'), at('```jsx'), at('## Read next'), at('references/design.md')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('inlines example.jsx verbatim inside its jsx fence and stays under the always-read cap', () => {
    const example = skillExample();
    expect(example).toMatch(/^---\n/);
    expect(sheet).toContain('```jsx\n' + example.trimEnd() + '\n```');
    expect(sheet).not.toContain('[[');
  });

  it('the example teaches the rules the prose no longer repeats', () => {
    const example = skillExample();
    for (const rule of ['static JSX', 'className', 'custom CSS lives here', '<Helmet>', '<Import name="sales"', 'sales.rows', 'ref:<id>', '$region', '"$monthly"', 'persistent id', 'never hand-rolled <svg>', '@2xl:', 'edit_id', 'visibility']) {
      expect(example, rule).toContain(rule);
    }
  });
});

describe('llms.txt and the discovery head', () => {
  it('the first line is the blurb, and the meta tag names npm afbin, Windows and email HTTP help, under 150 characters', () => {
    const text = llmsText(BASE);
    expect(text.split('\n')[0]).toBe(agentBlurb());
    const help = agentDiscovery(BASE);
    expect(help.url).toBe(`${BASE}/llms.txt`);
    expect(help.instruction).toBe(`afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.`);
    expect(help.instruction.length).toBeLessThanOrEqual(150);
    expect(help.instruction).toContain('afbin');
    expect(help.instruction).toContain('Windows: npx.cmd');
    expect(help.instruction).toContain('HTTP: email auth');
    expect(help.instruction).toContain('/llms.txt');
    expect(help.instruction).toContain('Local/offline editing needs no remote API.');
    // The blurb is still line 1 of the one-pager, still used elsewhere; the meta no longer repeats it.
    expect(help.instruction).not.toContain(agentBlurb());
  });

  it('the guide teaches npm CLI and email HTTP without retired installation or token doors', () => {
    const text = llmsText(BASE);
    for (const line of [`${BASE}/getting-started.md`, `${BASE}/getting-started`, 'afbin help', `${BASE}/a/<id>`, `${BASE}/@<user>/<id>-<slug>`, 'afbin preview report.jsx', 'afbin help http-api', 'skill']) {
      expect(text, line).toContain(line);
    }
    expect(text).not.toContain('[[');
    // Discovery links to the single setup guide; it does not maintain a second installer.
    expect(text).not.toContain('@afbin/cli@');
    const guide = gettingStartedMarkdown(BASE);
    expect(guide).toContain(afbinInstallCommand(BASE));
    expect(guide).toContain(afbinWindowsInstallCommand(BASE));
    expect(guide).toContain('artifactbin skill');
    expect(guide.split('npx --yes @afbin/cli@').length - 1).toBe(1);
    for (const [, command] of guide.matchAll(/@afbin\/cli@\S+ ([a-z-]+)/g)) expect(command).toBe('setup');
    // `afbin setup`, /raw, MCP and /docs/ are retired-surfaces.test.ts's row for the one-pager.
    expect(llmsText(`${BASE}/`)).toBe(text);
  });

  /**
   * PUSH VALIDATES. The brief's publishing guidance says there is no separate validate step — push
   * runs validation itself. The linked Getting started guide teaches the edit loop and must not
   * insert a redundant validate command before publishing.
   */
  it('its command line ends at push, because push validates — no separate validate step', () => {
    const edit = gettingStarted(DEFAULT_SERVER).sections.find(section => section.id === 'edit')!;
    expect(edit).toBeDefined();
    expect(edit.blocks.filter(block => block.kind === 'command').map(block => block.text)).toEqual([
      "afbin pull 'ARTIFACT_URL' --output artifact.jsx", 'afbin preview artifact.jsx', 'afbin push artifact.jsx',
    ]);
    expect(edit.blocks.map(block => block.text).join('\n')).toContain('Push validates the file before publishing.');
  });

  it('the head titles the help link for afbin and carries the afbin meta on the caller base', () => {
    expect(AGENT_HELP_TITLE).toBe('Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API');
    const head = agentDiscoveryHead(agentDiscovery('https://x.test/'));
    expect(head).toBe(`<link rel="help" href="https://x.test/llms.txt" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.">`);
  });
});

describe('npm setup keeps installed skills on the selected server',()=>{
  it.each(['https://docs.example','http://127.0.0.1:5001/'])('selects self-hosted origins on Unix and Windows: %s',(base)=>{
    const host=base.replace(/\/$/,'');
    expect(afbinInstallCommand(base).split('\n')[1]).toBe(`npx --yes @afbin/cli@latest setup --server '${host}'`);
    expect(afbinWindowsInstallCommand(base).split('\n')[1]).toBe(`npx.cmd --yes @afbin/cli@latest setup --server '${host}'`);
  });
  it.each([DEFAULT_SERVER,`${DEFAULT_SERVER}/`])('keeps the public setup command simple: %s',(base)=>{
    expect(afbinInstallCommand(base).split('\n')[1]).toBe('npx --yes @afbin/cli@latest setup');
    expect(afbinWindowsInstallCommand(base).split('\n')[1]).toBe('npx.cmd --yes @afbin/cli@latest setup');
  });
});
