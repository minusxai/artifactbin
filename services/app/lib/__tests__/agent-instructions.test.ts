import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const scopes = ['', 'services/app/lib/jsx', 'services/app/lib/story-ui'];

describe('agent instructions', () => {
  it.each(scopes)('%s gives both agents the same concise instructions', (scope) => {
    const read = (name: string) => readFileSync(path.join(root, scope, name), 'utf8');
    expect(read('CLAUDE.md')).toBe('@AGENTS.md\n');
    const instructions = read('AGENTS.md');
    expect(instructions.trim()).not.toBe('');
    /*
     * A CEILING, NOT A TARGET: these files are read in full at the start of every
     * session, so they have to stay something a reader finishes. Raised from 8 KiB
     * when the routine-checks bullet gained the local loop (`npm run dev` → `npm run
     * afbin` → `npm run eval`), which is the instruction that stops agents testing
     * CLI and skill changes against production. Adding to these files means earning
     * the room — say what changed here before moving this number again.
     */
    expect(Buffer.byteLength(instructions)).toBeLessThan(9728);
    for (const match of instructions.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (!target.includes('://') && !target.startsWith('#')) {
        expect(readFileSync(path.resolve(root, scope, target.split('#')[0]), 'utf8').length, target).toBeGreaterThan(0);
      }
    }
  });
});
