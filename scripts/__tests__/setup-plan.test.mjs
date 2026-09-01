// THE SETUP MODULE'S CONTRACT (node S1). One pure planner, one runner, two
// callers (`npm run setup`, and `docker run … node scripts/setup.mjs` inside the
// image). Seeded RED by the orchestrator.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEnvFile, defaultAnswers, existingAnswers, mergeEnvFile, parseArgs, questions } from '../lib/setup-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'setup.mjs');
const EXAMPLE = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
const exampleNames = [...EXAMPLE.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
const gen = { AUTH__SECRET: 'a'.repeat(43), ADMIN__SECRET: 'b'.repeat(43), CONTRACT__ACTOR_SECRET: 'c'.repeat(43), INTERNAL__SERVICE_SECRET: 'd'.repeat(43) };
const run = (args, opts = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: TMP, encoding: 'utf8', ...opts });

describe('questions()', () => {
  it('asks at most the decided things, in order, with defaults', () => {
    const q = questions();
    expect(q.map((x) => x.key)).toEqual(['publicUrl', 'port', 'email', 'emailFrom', 'database', 'databaseUrl', 'objects', 's3Url']);
    expect(q.find((x) => x.key === 'publicUrl').default).toBe('http://localhost:3030');
    expect(q.find((x) => x.key === 'email').secret).toBe(true);
    expect(typeof q.find((x) => x.key === 'emailFrom').when).toBe('function');
    expect(typeof q.find((x) => x.key === 'databaseUrl').when).toBe('function');
    expect(typeof q.find((x) => x.key === 's3Url').when).toBe('function');
    expect(q.find((x) => x.key === 'publicUrl').prompt).toContain('APP__PUBLIC_BASE_URL');
    expect(q.find((x) => x.key === 'email').prompt).toContain('EMAIL__RESEND_API_KEY');
    expect(q.find((x) => x.key === 'email').clearable).toBe(true);
    expect(q.find((x) => x.key === 'databaseUrl').clearable).not.toBe(true);
    expect(q.find((x) => x.key === 'database').prompt).toContain('DATABASE_URL');
    expect(q.find((x) => x.key === 'objects').prompt).toContain('S3_URL');
  });
});

describe('buildEnvFile()', () => {
  it('is .env.example made real: every example name, in order, secrets generated, optional storage left commented', () => {
    const text = buildEnvFile(defaultAnswers(), { generated: gen });
    const names = [...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
    for (const n of exampleNames) expect(names, n).toContain(n);
    expect(text).toMatch(/^AUTH__SECRET=a{43}$/m);
    expect(text).toMatch(/^ADMIN__SECRET=b{43}$/m);
    expect(text).toMatch(/^CONTRACT__ACTOR_SECRET=c{43}$/m);
    expect(text).toMatch(/^INTERNAL__SERVICE_SECRET=d{43}$/m);
    expect(text).toMatch(/^#\s*DATABASE_URL=/m);
    expect(text).toMatch(/^#\s*S3_URL=/m);
    expect(text).toMatch(/^OBJECT_STORE__LOCAL_DIR=\.\/data\/objects$/m);
    expect(text).toMatch(/^APP__PUBLIC_BASE_URL=http:\/\/localhost:3030$/m);
    expect(text).toMatch(/^APP__PORT=3030$/m);
    expect(text).not.toContain('dev-only-secret');
  });
  it('a Postgres answer sets DATABASE_URL and an S3 answer sets S3_URL', () => {
    const text = buildEnvFile({ ...defaultAnswers(), database: 'postgres', databaseUrl: 'postgresql://u:p@h/db', objects: 's3', s3Url: 's3://k:s@h/b/p' }, { generated: gen });
    expect(text).toMatch(/^DATABASE_URL=postgresql:\/\/u:p@h\/db$/m);
    expect(text).toMatch(/^S3_URL=s3:\/\/k:s@h\/b\/p$/m);
    expect(text).not.toMatch(/^OBJECT_STORE__LOCAL_DIR=/m);
  });
  it('a Resend key sets both mail names with a from derived from the public URL host', () => {
    const text = buildEnvFile({ ...defaultAnswers(), publicUrl: 'https://bin.example.com', email: 're_123' }, { generated: gen });
    expect(text).toMatch(/^EMAIL__RESEND_API_KEY=re_123$/m);
    expect(text).toMatch(/^EMAIL__FROM=artifact-bin <login@bin\.example\.com>$/m);
  });
  it('a port override makes the default public URL follow that port', () => {
    const answers = defaultAnswers({ port: 5299 });
    expect(answers).toMatchObject({ port: 5299, publicUrl: 'http://localhost:5299' });
    const text = buildEnvFile({ port: 5299 }, { generated: gen });
    expect(text).toMatch(/^APP__PUBLIC_BASE_URL=http:\/\/localhost:5299$/m);
    expect(text).toMatch(/^APP__PORT=5299$/m);
  });
});

describe('existing environment files', () => {
  const old = [
    'AUTH__SECRET=keep-auth',
    'APP__PUBLIC_BASE_URL=http://localhost:4040',
    'EMAIL__FROM=old@example.com',
    'EMAIL__RESEND_API_KEY=keep-email',
    'DATABASE_URL=postgresql://u:p@db/app',
    'S3_URL=s3://key:secret@objects/bucket',
    'MY_CUSTOM_SETTING=keep-me',
    '',
  ].join('\n');

  it('derives editable choices from current names without exposing secrets as defaults', () => {
    expect(existingAnswers(old)).toMatchObject({
      publicUrl: 'http://localhost:4040', port: 4040, email: 'keep-email',
      emailFrom: 'old@example.com', database: 'postgres', databaseUrl: 'postgresql://u:p@db/app',
      objects: 's3', s3Url: 's3://key:secret@objects/bucket',
    });
  });

  it('preserves values and custom settings and fills missing secrets', () => {
    const merged = mergeEnvFile(old, {}, { generated: gen });
    expect(merged).toMatch(/^AUTH__SECRET=keep-auth$/m);
    expect(merged).toMatch(/^APP__PUBLIC_BASE_URL=http:\/\/localhost:4040$/m);
    expect(merged).toMatch(/^EMAIL__FROM=old@example\.com$/m);
    expect(merged).toMatch(/^EMAIL__RESEND_API_KEY=keep-email$/m);
    expect(merged).toMatch(/^MY_CUSTOM_SETTING=keep-me$/m);
    expect(merged).toMatch(/^ADMIN__SECRET=b{43}$/m);
  });

  it('changes only explicit choices and can deliberately disable optional services', () => {
    const merged = mergeEnvFile(old, { port: 5050, email: '', objects: 'local' }, { generated: gen, supplied: new Set(['port', 'email', 'objects']) });
    expect(merged).toMatch(/^APP__PORT=5050$/m);
    expect(merged).toMatch(/^APP__PUBLIC_BASE_URL=http:\/\/localhost:4040$/m);
    expect(merged).toMatch(/^# EMAIL__RESEND_API_KEY=$/m);
    expect(merged).toMatch(/^# S3_URL=/m);
    expect(merged).toMatch(/^OBJECT_STORE__LOCAL_DIR=\.\/data\/objects$/m);
    expect(merged).toMatch(/^MY_CUSTOM_SETTING=keep-me$/m);
  });

  it('retains an unchanged driver-specific URL even when the editor would not create it', () => {
    const existing = 'DATABASE_URL=postgresql:///socket-db\n';
    expect(() => mergeEnvFile(existing, {}, { generated: gen })).not.toThrow();
    expect(mergeEnvFile(existing, {}, { generated: gen })).toMatch(/^DATABASE_URL=postgresql:\/\/\/socket-db$/m);
  });
});

describe('parseArgs()', () => {
  it('maps every flag', () => {
    const r = parseArgs(['--yes', '--out', '/x/.env', '--force', '--public-url', 'https://a.b', '--port', '4000', '--resend-key', 'k', '--email-from', 'f', '--database-url', 'postgresql://x', '--s3-url', 's3://y', '--print']);
    expect(r).toMatchObject({ yes: true, out: '/x/.env', force: true, print: true, answers: { publicUrl: 'https://a.b', port: 4000, email: 'k', emailFrom: 'f', databaseUrl: 'postgresql://x', s3Url: 's3://y' } });
    expect(parseArgs(['--no-interview']).yes).toBe(true);
  });
  it('rejects a bad port or URL', () => {
    expect(parseArgs(['--port', 'abc']).error).toMatch(/port/i);
    expect(parseArgs(['--public-url', 'not a url']).error).toMatch(/url/i);
  });
});

describe('scripts/setup.mjs (child process)', () => {
  it('--yes writes a 0600 .env, safely reuses it, --force replaces it, and --print masks', () => {
    const out = path.join(TMP, '.env');
    const first = run(['--yes', '--out', out]);
    expect(first.status, first.stderr).toBe(0);
    expect((fs.statSync(out).mode & 0o777).toString(8)).toBe('600');
    const text = fs.readFileSync(out, 'utf8');
    expect(text).toMatch(/^AUTH__SECRET=[A-Za-z0-9_-]{40,}$/m);
    expect(text).toMatch(/^INTERNAL__SERVICE_SECRET=[A-Za-z0-9_-]{40,}$/m);
    expect(text).not.toContain('dev-only-secret');
    expect(first.stdout).toMatch(/npm run dev/);
    const again = run(['--yes', '--out', out]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/already configured/i);
    expect(fs.readFileSync(out, 'utf8')).toBe(text);
    const forced = run(['--yes', '--out', out, '--force']);
    expect(forced.status).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).not.toBe(text);
    const printed = run(['--yes', '--print']);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toMatch(/^AUTH__SECRET=\*{4,}/m);
    expect(printed.stdout).not.toMatch(/^AUTH__SECRET=[A-Za-z0-9_-]{40,}$/m);
    expect(run(['--port', 'abc', '--yes', '--print']).status).toBe(3);
  });
  it('--port makes the default public URL follow it', () => {
    const printed = run(['--yes', '--print', '--port', '5299']);
    expect(printed.status, printed.stderr).toBe(0);
    expect(printed.stdout).toMatch(/^APP__PUBLIC_BASE_URL=http:\/\/localhost:5299$/m);
    expect(printed.stdout).toMatch(/^APP__PORT=5299$/m);
  });
});

describe('scripts/setup.mjs --no-next (S5: no dev hint inside the installer)', () => {
  it('prints Wrote but not the npm run dev hint with --no-next; keeps the hint without it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-nonext-'));
    const quiet = run(['--yes', '--out', path.join(dir, '.env'), '--no-next']);
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(quiet.stdout).toMatch(/Wrote /);
    expect(quiet.stdout).not.toMatch(/npm run dev/);
    const loud = run(['--yes', '--out', path.join(dir, '.env'), '--force']);
    expect(loud.status).toBe(0);
    expect(loud.stdout).toMatch(/Next: npm run dev/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
