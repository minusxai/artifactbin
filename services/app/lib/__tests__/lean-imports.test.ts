/**
 * THE LEAN APP IS A FACT, NOT A BUILD FLAG. Nothing in the app tree imports
 * DuckDB or Playwright — those live in the sql and browser packages, behind
 * their `./local` entry, and only a composition root (server.ts, a test
 * setup) may reach for them. An app built from this tree needs neither.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const TREES = ['app', 'lib', 'server', 'web'];
// '@artifactbin/contract' (SINGULAR) is the retired pre-split package; '@artifactbin/contracts' is
// the live one, so it needs an EXACT match, not the prefix rule the entries below use. The app
// tree imports nothing from the proxy — neither its package nor its source.
const FORBIDDEN_PREFIX = ['playwright', '@duckdb/', '@artifactbin/sql/local', '@artifactbin/browser/local', '@artifactbin/proxy', 'packages/proxy'];
const FORBIDDEN_EXACT = ['@artifactbin/contract'];

function* files(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') yield* files(p); }
    else if (/\.(ts|tsx|mts)$/.test(e.name)) yield p;
  }
}

describe('the app tree', () => {
  it('imports neither a native engine nor a browser', () => {
    const offenders: string[] = [];
    for (const tree of TREES) for (const f of files(path.join(ROOT, tree))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/gm)) {
        const spec = m[1] ?? m[2];
        if (FORBIDDEN_PREFIX.some((f) => spec === f || spec.startsWith(f)) || FORBIDDEN_EXACT.includes(spec)) offenders.push(`${path.relative(ROOT, f)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the service packages', () => {
  it('are not imported by the app tree at all — the clients live in utils', () => {
    const offenders: string[] = [];
    for (const tree of TREES) for (const f of files(path.join(ROOT, tree))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        if (m[1] === '@artifactbin/sql' || m[1] === '@artifactbin/browser' || m[1].startsWith('@artifactbin/sql/') || m[1].startsWith('@artifactbin/browser/')) offenders.push(`${path.relative(ROOT, f)} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the old contract package', () => {
  it('is gone: packages/contract does not exist and nothing imports it', () => {
    expect(fs.existsSync(path.join(ROOT, 'packages/contract'))).toBe(false);
  });
});
