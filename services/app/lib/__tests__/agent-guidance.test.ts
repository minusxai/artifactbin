/**
 * What an MCP client is told before it authors.
 *
 * An MCP client never fetches /docs/llm — it connects over the protocol, and
 * the tool schema is its ONLY instruction surface. ChatGPT proved this on
 * production: told merely "Tailwind classes via className", it fell back to its
 * own built-in slide skill and published a deck of bare <section>/<h1>/<ul>
 * with zero className attributes, which rendered as a wall of text.
 *
 * So the non-negotiables have to live IN the schema, not behind a link. These
 * tests pin the ones whose absence produced that page.
 */
import { describe, it, expect } from 'vitest';
import { renderDoc } from '@/lib/skills';
import { COMPUTED_FIGURE_RULE, MARKUP_FIELD_GUIDANCE, MARKUP_STYLE_RULE } from '@/lib/agent-guidance';

describe('the markup field description', () => {
  const text = MARKUP_FIELD_GUIDANCE;

  it('states that styling is className-only, in the schema itself', () => {
    expect(text).toMatch(/className/);
    expect(MARKUP_STYLE_RULE).toMatch(/className/);
  });

  it('warns that unstyled markup renders unstyled — the failure that shipped', () => {
    // ChatGPT had no way to know bare HTML was a mistake; nothing said so.
    expect(text).toMatch(/unstyled|plain text|no styling/i);
  });

  it('names the wrapper the document must start with', () => {
    expect(text).toMatch(/data-design="tw"/);
  });

  it('rejects inline style= while naming the one allowed <style> override seam', () => {
    expect(text).toMatch(/<style>/);
    expect(text).toMatch(/style=/);
  });

  it('points at the full reference by an absolute, fetchable path', () => {
    expect(text).toMatch(/\/docs\/artifact-bin\/references\/markup\.md/);
  });

  it('stays short enough to survive in a tool schema', () => {
    // A description an agent skims must be skimmable; this is a budget, not a
    // style note. The cap rose from 900 when COMPUTED_FIGURE_RULE was added —
    // every entry in here is a bug that shipped, so the total grows as the list
    // of lessons does, and holding a round number would have meant deleting one
    // to make room. What actually protects skimmability is the per-rule cap
    // below: the failure mode is one rambling clause, not one more terse line.
    expect(text.length).toBeLessThan(1050);
  });

  it('keeps every individual rule terse', () => {
    const longest = text.split(/(?<=\.) (?=[A-Z<])/).reduce((a, b) => (a.length > b.length ? a : b));
    expect(longest.length).toBeLessThan(230);
  });
});

describe('figures must be computed, not typed', () => {
  // Codex published a report whose prose read "totals 19400" while the <Number>
  // beside it computed 19,300 from the same rows. The component was right; the
  // agent's mental arithmetic was not. Nothing in any instruction surface told
  // it to stop doing arithmetic in its head — the docs explained what <Number>
  // IS, never when to reach for it. A report that contradicts its own data is
  // the exact failure this data tier exists to prevent, so the rule is a named
  // constant carried by BOTH surfaces rather than a sentence someone might
  // reword out of one of them.
  it('the rule names the component and forbids the alternative', () => {
    expect(COMPUTED_FIGURE_RULE).toMatch(/<Number/);
    expect(COMPUTED_FIGURE_RULE).toMatch(/NEVER/);
    expect(COMPUTED_FIGURE_RULE).toMatch(/prose/i);
  });

  it('rides in the SCHEMA, the only surface an MCP client reads', () => {
    expect(MARKUP_FIELD_GUIDANCE).toContain(COMPUTED_FIGURE_RULE);
  });

  it('and in the component reference, for an agent that fetches docs instead', () => {
    expect(renderDoc('artifact-bin/references/markup-data.md', 'https://example.test')).toContain(COMPUTED_FIGURE_RULE);
  });
});

describe('the sheetUrl description', () => {
  it('tells the agent the SERVER fetches the sheet', async () => {
    const { SHEET_URL_FIELD_GUIDANCE } = await import('@/lib/agent-guidance');
    // ChatGPT refused an import and asked the user to connect Google Drive,
    // believing it needed access itself. The schema must rule that out.
    expect(SHEET_URL_FIELD_GUIDANCE).toMatch(/DO NOT NEED ACCESS|server-side/i);
    expect(SHEET_URL_FIELD_GUIDANCE).toMatch(/not fetch it yourself/i);
  });
});
