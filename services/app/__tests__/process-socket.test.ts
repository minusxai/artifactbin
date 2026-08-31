/**
 * testmig-5 seed — processes and sockets in tests: one owner each.
 *
 * Fixed ports collide across worktrees (MEASURED: 4863, 4869, 5221 are literals in three tests); six tests hand-roll the
 * same http server dance; two suites each spawn the schema generator. After this phase `net.ts` owns sockets,
 * `rendered-schema.ts` owns the render, and `mint-ceiling` loops to the configured ceiling instead of a magic ×4.
 * Escape hatch as in the harness rollout: `// socket-exempt: <reason>` for a file whose socket handling IS the subject;
 * pin 1 caps them at 3.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, withHttpServer } from './net';
import { renderedSchema, renders } from './rendered-schema';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OWN = new Set(['services/app/__tests__/net.ts', 'services/app/__tests__/rendered-schema.ts', 'services/app/__tests__/process-socket.test.ts']);
const testFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.test\.(ts|tsx|mjs)$/.test(e.name) || /__tests__\/.*\.ts$/.test(path.relative(ROOT, full))) out.push(path.relative(ROOT, full));
    }
  };
  for (const s of ['services/app', 'services/proxy', 'services/sql', 'services/utils', 'services/browser']) walk(path.join(ROOT, s));
  return out.filter((f) => !OWN.has(f)).sort();
};
const files = testFiles().map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));
const exempt = (t: string) => /^\s*\/\/ socket-exempt: \S.*$/m.test(t);

describe('sockets have one owner', () => {
  it('1. no test creates an http(s) server itself — it asks withHttpServer; exemptions ≤ 3, each with a reason', () => {
    const offenders = files.filter(({ text }) => !exempt(text) && /\bcreateServer\(/.test(text) && /from ['"]node:https?['"]/.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
    const exempted = files.filter(({ text }) => exempt(text)).map(({ rel }) => rel);
    expect(exempted.length, exempted.join('\n')).toBeLessThanOrEqual(3);
  });
  it('2. no test binds or hands a child a literal port — ephemeral only', () => {
    // A BIND or a port constant handed to a child — a config test that merely parses '5613' is not a socket.
    const literal = /\blisten\(\s*\d{2,5}\b|\bconst PORT\s*=\s*\d{4,5}\b/;
    expect(files.filter(({ text }) => literal.test(text)).map(({ rel }) => rel)).toEqual([]);
  });
  it('3. withHttpServer serves on a fresh loopback port, closes idempotently, and two servers never share a port', async () => {
    const a = await withHttpServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('a'); });
    const b = await withHttpServer((_req, res) => { res.end('b'); });
    expect(a.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(a.port).not.toBe(b.port);
    expect(await (await fetch(`${a.base}/x`)).text()).toBe('a');
    await a.close(); await a.close(); await b.close();
    await expect(fetch(`${a.base}/x`)).rejects.toThrow();
    const p = await freePort();
    expect(p).toBeGreaterThan(1024);
  });
});

describe('the schema is rendered once per process', () => {
  it('4. no test spawns render-schema.mjs itself', () => {
    expect(files.filter(({ text }) => /render-schema\.mjs/.test(text)).map(({ rel }) => rel)).toEqual([]);
  });
  it('5. renderedSchema() returns the generator\'s four parts and a second call spawns nothing', () => {
    const first = renderedSchema();
    expect(first.schema).toMatch(/CREATE TABLE/i);
    expect(typeof first.roles).toBe('string');
    expect(typeof first.grants).toBe('string');
    expect(Object.keys(first.tables).length).toBeGreaterThan(3);
    expect(renders.count).toBe(1);
    expect(renderedSchema()).toBe(first);
    expect(renders.count).toBe(1);
  }, 30_000);
});

describe('mint-ceiling stops just past the configured ceiling', () => {
  it('6. the loop bound comes from doorConfig, not a magic multiplier', () => {
    const text = fs.readFileSync(path.join(ROOT, 'services/app/__tests__/mint-ceiling.test.ts'), 'utf8');
    expect(text).not.toMatch(/\*\s*4\s*\+\s*5/);
    expect(text).toMatch(/doorConfig\(/);
  });
});
