/**
 * THE LEAN CLOSURE, pinned (cleanup/lean-1) — seeded RED by the orchestrator from the measured research
 * (briefs/research-evidence/deadcode in the prod repo). What each lean image may and may not carry is named in
 * scripts/image-checks.mjs (CI builds the images and asks); what the app declares as runtime is only what it imports at
 * runtime; every env name a service reads is documented; nothing reads a retired name; the one proven-dead file is gone.
 * Make green without changing an expectation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RETIRED_ENV_NAMES } from '../config';

const root = new URL('../../../../', import.meta.url);
const has = (p: string) => existsSync(new URL(p, root));
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const pkg = (p: string) => JSON.parse(read(p)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

describe('the image guard names what each lean image must NOT carry', () => {
  const guard = read('scripts/image-checks.mjs');
  const kind = (name: string) => guard.slice(guard.indexOf(`  ${name}: {`), guard.indexOf('budgetMB', guard.indexOf(`  ${name}: {`)));
  it('the lean proxy carries no PGLite engine or dialect (28 MB measured), no Vite/Vitest, no React DOM', () => {
    const proxy = kind('proxy');
    for (const dep of ['@electric-sql/pglite', 'kysely-pglite', 'vite', 'vitest', 'react-dom']) expect(proxy, dep).toContain(`'${dep}'`);
  });
  it('the lean app carries no build-time CSS toolchain (Tailwind/PostCSS/lightningcss, 42 MB measured) and no Vite', () => {
    const app = kind('app');
    for (const dep of ['@tailwindcss/postcss', 'tailwindcss', 'lightningcss', 'vite']) expect(app, dep).toContain(`'${dep}'`);
  });
  it('boots protected SQL/browser images with an explicit service credential', () => {
    for (const name of ['sql', 'browser']) expect(kind(name)).toContain('INTERNAL__SERVICE_SECRET');
    expect(guard).toContain('x-artifactbin-service-secret');
  });
  it('binds image probes only inside the assigned 7000-7200 range', () => {
    expect(guard).toContain('7120');
    expect(guard).toContain('7129');
    expect(guard).not.toContain('5220');
  });
});

describe('the app declares as runtime only what it imports at runtime', () => {
  it('the CSS toolchain is a dev dependency', () => {
    const { dependencies = {}, devDependencies = {} } = pkg('services/app/package.json');
    for (const dep of ['@tailwindcss/postcss', 'tailwindcss']) {
      expect(dependencies, dep).not.toHaveProperty(dep);
      expect(devDependencies, dep).toHaveProperty(dep);
    }
    expect(dependencies).not.toHaveProperty('kysely-pglite');
  });
  it('contracts declares the hono it imports', () => {
    const { dependencies = {}, devDependencies = {} } = pkg('services/contracts/package.json');
    const c = JSON.parse(read('services/contracts/package.json')) as { peerDependencies?: Record<string, string> };
    expect({ ...dependencies, ...devDependencies, ...(c.peerDependencies ?? {}) }).toHaveProperty('hono');
  });
});

describe('every env name a service reads is documented, and retired names are not read', () => {
  const readNames = (file: string): Set<string> => {
    const src = read(file);
    const names = new Set<string>();
    for (const m of src.matchAll(/env\(\s*'([A-Z_]+)'\s*,\s*'([A-Z_]+)'\s*\)/g)) names.add(`${m[1]}__${m[2]}`);
    return names;
  };
  const documented = read('.env.example');
  it('the app config', () => {
    const undocumented = [...readNames('services/app/lib/config.ts')].filter((n) => !new RegExp(`^#?\\s*${n}=`, 'm').test(documented) && !documented.includes(n));
    expect(undocumented).toEqual([]);
  });
  it('the standalone proxy config', () => {
    const undocumented = [...readNames('services/proxy/src/config.ts')].filter((n) => !documented.includes(n));
    expect(undocumented).toEqual([]);
  });
  it('INVITE__CODE and WAITLIST__WEBHOOK_URL are retired names, no longer read', () => {
    expect(RETIRED_ENV_NAMES).toHaveProperty('INVITE__CODE');
    expect(RETIRED_ENV_NAMES).toHaveProperty('WAITLIST__WEBHOOK_URL');
    const cfg = read('services/app/lib/config.ts');
    expect(cfg).not.toMatch(/env\(\s*'INVITE'\s*,\s*'CODE'\s*\)/);
    expect(cfg).not.toMatch(/env\(\s*'WAITLIST'\s*,\s*'WEBHOOK_URL'\s*\)/);
  });
});

describe('the one proven-dead file is gone', () => {
  it('services/app/lib/email-shape.ts (3 lines, zero importers)', () => {
    expect(has('services/app/lib/email-shape.ts')).toBe(false);
  });
});
