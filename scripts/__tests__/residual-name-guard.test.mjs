import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(ROOT, 'scripts', 'check-residual-names.mjs');
const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function repository(files, allowlist = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifactbin-residual-'));
  temporary.push(root);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const allowlistPath = path.join(root, 'scripts', 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', ...Object.keys(files)]);
  return { root, allowlistPath };
}

const run = ({ root, allowlistPath }) => spawnSync(process.execPath, [GUARD, '--root', root, '--allowlist', allowlistPath], { encoding: 'utf8' });

describe('residual-name guard', () => {
  it('rejects historical, British, underscore/case, and plural-typo spellings', () => {
    const variants = [
      ['artifact', 'bin'].join('-'),
      ['Artifact', 'Bin'].join(' '),
      ['ARTIFACT', 'BIN'].join('_'),
      ['artefact', 'bin'].join('-'),
      ['Artefact', 'Bin'].join(' '),
      ['ARTEFACT', 'BIN'].join('_'),
      ['artifacts', 'bin'].join(''),
      ['Artifacts', 'bin'].join(''),
    ];
    const fixture = repository({ 'identity.txt': variants.join('\n') });
    const result = run(fixture);
    expect(result.status).toBe(1);
    for (const variant of variants) expect(`${result.stdout}${result.stderr}`).toContain(variant);
  });

  it('requires the exact allowed occurrence count', () => {
    const oldName = ['artifact', 'bin'].join('-');
    const fixture = repository({ 'history.txt': `${oldName}\n${oldName}\n` }, [
      { path: 'history.txt', value: oldName, count: 1, reason: 'fixture' },
    ]);
    expect(run(fixture).status).toBe(1);
    fs.writeFileSync(fixture.allowlistPath, JSON.stringify([
      { path: 'history.txt', value: oldName, count: 2, reason: 'fixture' },
    ]));
    expect(run(fixture).status).toBe(0);
  });

  it('does not inspect ignored or otherwise untracked files', () => {
    const oldName = ['artifact', 'bin'].join('-');
    const fixture = repository({ '.gitignore': '.env\n', 'tracked.txt': 'artifactbin\n' });
    fs.writeFileSync(path.join(fixture.root, '.env'), `${oldName}\n`);
    expect(run(fixture).status).toBe(0);
  });
});
