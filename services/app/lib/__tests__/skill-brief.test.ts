/**
 * The brief (`skills/artifactbin/SKILL.md`) is the ONE file a harness reads on
 * its own: its description is always in context, its body loads on trigger,
 * and the references load only when the body sends the agent there. So the
 * description must be the trigger, the body must carry the example verbatim,
 * and both must fit the caps. The same folder holds `llms.txt` — the served
 * one-pager for an agent that has nothing installed — whose first line is the
 * blurb every discovery surface (the meta tag) repeats.
 */
import { describe, it, expect } from 'vitest';
import { buildQuickSheet, skillExample, skillTree, QUICK_SHEET_MAX_BYTES } from '../skills';
import { AGENT_HELP_TITLE, agentBlurb, agentDiscovery, agentDiscoveryHead, llmsText } from '../agent-discovery';

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
    expect(Buffer.byteLength(sheet)).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
    expect(sheet).not.toContain('[[');
  });

  it('the example teaches the rules the prose no longer repeats', () => {
    const example = skillExample();
    for (const rule of ['static JSX', 'className', 'never inline', '<Helmet>', 'public.rows', 'ref:<id>', '$region', '"$sales"', 'persistent id', 'never hand-rolled <svg>', '@2xl:', 'edit_id', 'visibility']) {
      expect(example, rule).toContain(rule);
    }
  });
});

describe('llms.txt and the discovery head', () => {
  it('the first line is the blurb, and the meta tag names afbin plus the install one-liner, under 150 characters', () => {
    const text = llmsText(BASE);
    expect(text.split('\n')[0]).toBe(agentBlurb());
    const help = agentDiscovery(BASE);
    expect(help.url).toBe(`${BASE}/llms.txt`);
    expect(help.instruction).toBe(`afbin: a CLI to operate artifacts. Install: curl -fsSL ${BASE}/chat/install.sh | sh`);
    expect(help.instruction.length).toBeLessThanOrEqual(150);
    expect(help.instruction).toContain('afbin');
    // The blurb is still line 1 of the one-pager, still used elsewhere; the meta no longer repeats it.
    expect(help.instruction).not.toContain(agentBlurb());
  });

  it('the one-pager says what artifactbin is, how to install, both URL forms, and where the reference is — no setup, no token', () => {
    const text = llmsText(BASE);
    for (const line of [`curl -fsSL ${BASE}/chat/install.sh | sh`, 'afbin help', `${BASE}/a/<id>`, `${BASE}/@<user>/<id>-<slug>`, 'afbin pull', 'afbin validate', 'afbin push', 'skill']) {
      expect(text, line).toContain(line);
    }
    expect(text).not.toContain('afbin setup');
    expect(text).not.toContain('[[');
    expect(text).not.toMatch(/\/raw\b|MCP|\/docs\//);
    expect(llmsText(`${BASE}/`)).toBe(text);
  });

  it('the head titles the help link for afbin and carries the afbin meta on the caller base', () => {
    expect(AGENT_HELP_TITLE).toBe('Agents: read this to create, edit, or operate artifacts on the CLI using afbin');
    const head = agentDiscoveryHead(agentDiscovery('https://x.test/'));
    expect(head).toBe(`<link rel="help" href="https://x.test/llms.txt" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="afbin: a CLI to operate artifacts. Install: curl -fsSL https://x.test/chat/install.sh | sh">`);
  });
});
