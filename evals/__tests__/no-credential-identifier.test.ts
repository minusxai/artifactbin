/**
 * No identifier in `evals/` may spell a variable NAME like a key.
 *
 * CodeQL's credential heuristic treats such an identifier as a secret, so the
 * error message that names WHICH key to set ("FIREWORKS_API_KEY is not set")
 * gets flagged as clear-text logging of a credential — high severity, and a red
 * check on every PR. The value is a variable NAME, never a key.
 *
 * This is a guard, not a style rule: the rename was made once, undone by a later
 * refactor, and the alert came back. Two things are deliberately allowed — the
 * user-facing flag `--api-key-env`, which is a string literal rather than an
 * identifier, and `apiKey` itself, which holds the real secret, is scrubbed
 * from everything written or printed, and reaches no sink.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const EVALS = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '.metrics' || e.name === 'node_modules' ? [] : sources(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('a variable NAME must not be spelled like a key', () => {
  it('no identifier anywhere in evals/ is apiKeyEnv (or a sibling)', () => {
    const offenders: string[] = [];
    for (const file of sources(EVALS)) {
      if (file.endsWith('no-credential-identifier.test.ts')) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // `apiKey` + a suffix is the giveaway: it names the VARIABLE, not the secret.
        // Comments and the CLI flag string are exempt — only identifiers trip the heuristic.
        if (/\bapiKey(Env|Name|Var)[A-Za-z0-9_]*\b/.test(line) && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//')) {
          offenders.push(`${path.relative(EVALS, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
