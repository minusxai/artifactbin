/**
 * The gate manifest agrees with the disk, with the runner, and with every
 * gate's own source.
 *
 * The row shape is deliberately small: `{ name, needsMail, serialGroup?,
 * needsGenerationFixture?, timeoutMs }`, and every one of those fields is read
 * by scripts/gates.mjs. The fields that used to be here and were read by
 * nothing — `start`, `why`, `needsClipboard` — drifted precisely because
 * nothing could contradict them, so rule 2 now refuses them outright.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GATE_SPECS, checkManifest, specFor } from '../gates.manifest.mjs';
import { parseShard, shardOf } from '../gates.shard.mjs';

const SCRIPTS = path.resolve(import.meta.dirname, '..');
const onDisk = readdirSync(SCRIPTS).filter((f) => f.startsWith('gate-') && f.endsWith('.mjs')).map((f) => f.slice(5, -4)).sort();
const source = (name) => readFileSync(path.join(SCRIPTS, `gate-${name}.mjs`), 'utf8');
const MAIL = /dev-mail|DEV_OUTBOX|startMailSink|\/mail\b|mailSink|MAIL_SINK|readCode|latestCode|becomeAccountOwner/;
const ALLOWED_FIELDS = new Set(['name', 'needsMail', 'serialGroup', 'needsGenerationFixture', 'timeoutMs']);

describe('the manifest and the disk are one set', () => {
  it('1. every gate file has a row and every row has a file', () => {
    expect(onDisk.length).toBeGreaterThanOrEqual(30);
    expect([...GATE_SPECS].map((s) => s.name).sort()).toEqual(onDisk);
  });

  it('2. every row is well-formed, and carries no field the runner does not read', () => {
    for (const spec of GATE_SPECS) {
      expect(Object.keys(spec).filter((key) => !ALLOWED_FIELDS.has(key)), spec.name).toEqual([]);
      expect(typeof spec.needsMail, spec.name).toBe('boolean');
      expect(Number.isInteger(spec.timeoutMs) && spec.timeoutMs > 0, `${spec.name} timeoutMs`).toBe(true);
      if (spec.serialGroup !== undefined) expect(typeof spec.serialGroup, spec.name).toBe('string');
      if (spec.needsGenerationFixture !== undefined) expect(spec.needsGenerationFixture, spec.name).toBe(true);
    }
  });

  it('3. every timeout obeys the formula’s floor and stays a budget, not a nap', () => {
    for (const spec of GATE_SPECS) {
      expect(spec.timeoutMs, `${spec.name} is below the cold-start floor`).toBeGreaterThanOrEqual(60_000);
      // 3 × measured, and no gate measured anywhere near two minutes.
      expect(spec.timeoutMs, `${spec.name} budgets more than six minutes`).toBeLessThanOrEqual(360_000);
      expect(spec.timeoutMs % 10_000, `${spec.name} is not rounded to ten seconds`).toBe(0);
    }
  });
});

describe('the rows tell the truth about their sources', () => {
  it('4. needsMail ⇔ the gate reads the mail sink; a clipboard gate is in the clipboard serial group', () => {
    for (const name of onDisk) {
      const src = source(name);
      const spec = specFor(name);
      expect(spec.needsMail, `${name} needsMail`).toBe(MAIL.test(src));
      // The clipboard is one shared device on the machine, so the gates that
      // drive it really run one at a time — the group is how that is arranged.
      if (/clipboard/i.test(src)) expect(spec.serialGroup, `${name} drives the clipboard`).toBe('clipboard');
    }
  });

  it('5. needsGenerationFixture ⇔ the gate reads the fixture model server', () => {
    for (const name of onDisk) {
      expect(specFor(name).needsGenerationFixture === true, `${name} needsGenerationFixture`)
        .toBe(/GENERATION_FIXTURE_URL|generation-fixture/.test(source(name)));
    }
  });

  it('6. checkManifest names every missing row and every orphan row in one error, and is silent when they match', () => {
    const rows = [{ name: 'a' }, { name: 'zzz-orphan' }];
    let message = '';
    try { checkManifest(['a', 'b-missing'], rows); } catch (e) { message = String(e); }
    expect(message).toContain('b-missing');
    expect(message).toContain('zzz-orphan');
    expect(() => checkManifest(['a', 'b'], [{ name: 'b' }, { name: 'a' }])).not.toThrow();
  });

  it('7. the runner consults the manifest: bijection at startup, timeout, serial group, mail, fixture', () => {
    const runner = readFileSync(path.join(SCRIPTS, 'gates.mjs'), 'utf8');
    expect(runner).toMatch(/from '\.\/gates\.manifest\.mjs'/);
    expect(runner).toMatch(/checkManifest\(/);
    for (const field of ['timeoutMs', 'serialGroup', 'needsMail', 'needsGenerationFixture']) {
      expect(runner, `the runner never reads ${field}`).toContain(field);
    }
    // No gate is special-cased by NAME in the runner: that is what the fields are for.
    expect(runner).not.toMatch(/gate\.name\s*===\s*'/);
    const listed = execFileSync(process.execPath, [path.join(SCRIPTS, 'gates.mjs'), '--list'], { encoding: 'utf8' }).trim().split('\n').sort();
    expect(listed).toEqual(onDisk);
  });

  it('8. every gate reports through the one verdict dialect, or asserts and throws', () => {
    for (const name of onDisk) {
      const src = source(name);
      if (!/createChecker\(/.test(src)) {
        // The alternative is node:assert, which fails the process on the spot.
        expect(src, `${name} neither checks nor asserts`).toMatch(/from ['"]node:assert/);
        continue;
      }
      expect(src, `${name} makes a checker but never reports its verdict`).toMatch(/check\.done\(\)/);
      // The two collector dialects this replaced are gone for good.
      expect(src, `${name} still defines its own collector`).not.toMatch(/^const (ok|check) = \((?:c|ok|pass|condition), /m);
    }
  });
});

/**
 * SHARDING reads the same rows: `timeoutMs` is the weight CI's three shards are
 * balanced on, so the split lives or dies by the measurements above.
 */
describe('the shards are cut from those rows', () => {
  const NAMES = GATE_SPECS.map((s) => s.name);
  const weight = (name) => specFor(name).timeoutMs;

  it('9. parseShard reads i/n, is null when the flag is absent, and refuses a shard that cannot exist', () => {
    expect(parseShard('--shard=1/2')).toEqual({ index: 1, total: 2 });
    expect(parseShard('--shard=3/3')).toEqual({ index: 3, total: 3 });
    expect(parseShard(undefined)).toBeNull();
    // Silently running nothing is how a sharded CI job goes green having tested nothing at all.
    for (const bad of ['--shard=0/2', '--shard=3/2', '--shard=1/0', '--shard=x/2', '--shard=1', '--shard=-1/2']) {
      expect(() => parseShard(bad), bad).toThrow();
    }
  });

  it('10. every gate lands in exactly one shard, for one, two, three and four of them', () => {
    expect(shardOf(NAMES, { index: 1, total: 1 }, weight)).toEqual(NAMES);
    for (const total of [2, 3, 4]) {
      const seen = [];
      for (let index = 1; index <= total; index++) seen.push(...shardOf(NAMES, { index, total }, weight));
      expect(seen.slice().sort(), `${total} shards`).toEqual(NAMES.slice().sort());
      expect(new Set(seen).size, `${total} shards`).toBe(NAMES.length);
    }
  });

  it('11. the split balances by WEIGHT, not by count, and is deterministic', () => {
    const totals = [1, 2].map((index) => shardOf(NAMES, { index, total: 2 }, weight)
      .reduce((sum, name) => sum + weight(name), 0));
    const mean = (totals[0] + totals[1]) / 2;
    expect(Math.max(...totals), `${totals.join(' vs ')}`).toBeLessThanOrEqual(mean * 1.25);
    expect(shardOf(NAMES, { index: 1, total: 3 }, weight)).toEqual(shardOf(NAMES, { index: 1, total: 3 }, weight));
  });

  it('12. the two heaviest gates never share a shard', () => {
    const heaviest = [...NAMES].sort((a, b) => weight(b) - weight(a)).slice(0, 2);
    const first = shardOf(NAMES, { index: 1, total: 2 }, weight);
    expect(first.includes(heaviest[0])).toBe(true);
    expect(first.includes(heaviest[1])).toBe(false);
  });
});
