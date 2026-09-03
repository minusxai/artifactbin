/**
 * M3 — publish before you polish.
 *
 * Measured on the last real eval run: the first successful publish landed 87 s into a 161 s run, and 50 s
 * into a 285 s one. For most of that the human had nothing — while the brief told the agent to read four
 * reference files before writing anything. "Be quick" on top of that is a contradiction it resolves by
 * ignoring one; the fix is the ORDER, and one rule that settles it.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
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

describe('the brief tells the agent to publish first', () => {
  it('says to publish a skeleton before reading the references', () => {
    expect(sheet()).toMatch(/publish[^.]*\b(skeleton|first)\b/i);
  });

  it('names edit_artifact as how the sections get filled in', () => {
    expect(sheet()).toMatch(/edit_artifact/);
  });

  it('states the rule that resolves the contradiction — reading never precedes the first publish', () => {
    expect(sheet()).toMatch(/never precedes the first publish|before you read|publish .* then read/i);
  });

  it('puts the publish-first instruction AHEAD of the reading path', () => {
    expect(before(sheet(), /publish/i, /design\.md/)).toBe(true);
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
  it('tells a tool-calling agent to publish before reading too', () => {
    expect(buildMcpInstructions(BASE)).toMatch(/publish[^.]*\b(skeleton|first)\b/i);
  });

  /** Extended: and names the fill-in move, in the same order the brief teaches. */
  it('names edit_artifact as the fill-in move, after the skeleton', () => {
    expect(before(buildMcpInstructions(BASE), /skeleton/i, /edit_artifact/)).toBe(true);
  });
});
