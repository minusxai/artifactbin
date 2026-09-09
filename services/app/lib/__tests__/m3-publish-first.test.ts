import { describe, it, expect } from 'vitest';
import { buildQuickSheet, buildMcpInstructions, QUICK_SHEET_MAX_BYTES } from '@/lib/skills';

const BASE = 'https://artifactbin.dev';
const sheet = () => buildQuickSheet(BASE);

/** The order is what is being tested, so the assertions are about POSITION, not presence. */
const before = (text: string, first: RegExp, second: RegExp) => {
  const a = text.search(first);
  const b = text.search(second);
  expect(a, `${first} missing`).toBeGreaterThanOrEqual(0);
  expect(b, `${second} missing`).toBeGreaterThanOrEqual(0);
  return a < b;
};

describe('the brief distinguishes existing documents from new work', () => {
  it('creates a skeleton only when no document was supplied', () => {
    expect(sheet()).toMatch(/With no supplied document, create a titled skeleton/i);
  });

  it('provides the HTTP edit route for filling sections', () => {
    expect(sheet()).toContain('/api/artifacts/<id>/edits');
  });

  it('puts supplied-document reuse before the new-document example', () => {
    expect(before(sheet(), /Use the supplied document ID/i, /For a NEW document only/i)).toBe(true);
    expect(sheet()).toMatch(/never create a replacement\s+to recover from an error/i);
  });

  it('puts the reuse instruction ahead of the reading path', () => {
    expect(before(sheet(), /Use the supplied document ID/i, /design\.md/)).toBe(true);
  });

  it('still sends the agent to the design and markup references', () => {
    expect(sheet()).toMatch(/design\.md/);
    expect(sheet()).toMatch(/markup\.md/);
  });

  /** Extended: the SKELETON sentence itself must lead, not merely the word "publish". */
  it('puts the SKELETON instruction itself ahead of the reading path', () => {
    expect(before(sheet(), /skeleton/i, /design\.md/)).toBe(true);
  });

  it('stays inside the byte cap that shapes the whole rewrite', () => {
    expect(Buffer.byteLength(sheet(), 'utf8')).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
  });
});

describe('the MCP instructions teach the same order', () => {
  it('gives tool-calling agents the same reuse-first rule', () => {
    const text = buildMcpInstructions(BASE);
    expect(before(text, /Use the supplied document ID/i, /If no document was supplied, create a titled skeleton/i)).toBe(true);
    expect(text).toMatch(/never create a replacement to recover from an error/i);
  });

  /** Extended: and names the fill-in move, in the same order the brief teaches. */
  it('names edit_artifact as the fill-in move, after the skeleton', () => {
    expect(before(buildMcpInstructions(BASE), /skeleton/i, /edit_artifact/)).toBe(true);
  });
});
