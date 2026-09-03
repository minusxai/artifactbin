/**
 * Production run 33702277600 (2026-09-03), pi scrolly leg: the agent read the skill tree AND the task's own
 * check list out of the runner's checkout instead of over the wire. The eval must SEE that. Seeded RED by
 * the orchestrator; the fixture is that run's real transcript (assistant events only, tokens redacted).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pi } from '../lib/harness/pi';
import { codex } from '../lib/harness/codex';
import { CHECKOUT_MARKERS, countCheckoutReads } from '../lib/local-reads';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const ROOT = '/home/runner/work/deploys/deploys';

describe('reads of the local checkout', () => {
  it('the adapters expose every tool invocation, not only a docs-read count', () => {
    const r = pi.reduce(fx('pi.scrolly.checkout.jsonl'));
    expect(r.invocations.length).toBeGreaterThanOrEqual(20);
  });
  it('the real pi scrolly run read the checkout at least eight times', () => {
    const r = pi.reduce(fx('pi.scrolly.checkout.jsonl'));
    expect(countCheckoutReads(r.invocations, [ROOT])).toBeGreaterThanOrEqual(8);
  });
  it('a run that never touched the checkout counts zero', () => {
    const r = codex.reduce(fx('codex.deck.jsonl'));
    expect(countCheckoutReads(r.invocations, [ROOT])).toBe(0);
  });
  it('the relative markers catch the rubric and the skill tree even without the absolute root', () => {
    expect(CHECKOUT_MARKERS).toEqual(expect.arrayContaining(['evals/tasks/', 'services/app/skills/']));
    const calls = [
      { name: 'bash', input: { command: 'cat ../deploys/evals/tasks/scrolly.eval.json' } },
      { name: 'read', input: { path: '/x/services/app/skills/artifactbin/SKILL.md' } },
      { name: 'bash', input: { command: 'curl -s https://artifactbin.dev/docs/artifactbin/SKILL.md' } },
    ];
    expect(countCheckoutReads(calls, [])).toBe(2);
  });
});
