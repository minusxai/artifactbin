/**
 * testmig-6 seed — the gate manifest agrees with the disk and with every gate's own source.
 * Six pins, red at handoff (the manifest is empty; the runner does not consult it).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GATE_SPECS, checkManifest, specFor } from '../gates.manifest.mjs';

const SCRIPTS = path.resolve(import.meta.dirname, '..');
const onDisk = readdirSync(SCRIPTS).filter((f) => f.startsWith('gate-') && f.endsWith('.mjs')).map((f) => f.slice(5, -4)).sort();
const source = (name) => readFileSync(path.join(SCRIPTS, `gate-${name}.mjs`), 'utf8');
const MAIL = /mail-relay|\/mail\b|mailSink|MAIL_SINK|readCode|latestCode|EMAIL__RESEND/;

describe('the manifest and the disk are one set', () => {
  it('1. every gate file has a row and every row has a file', () => {
    expect(onDisk.length).toBeGreaterThanOrEqual(30);
    expect([...GATE_SPECS].map((s) => s.name).sort()).toEqual(onDisk);
  });
  it('2. every row is well-formed and every exception says why', () => {
    for (const s of GATE_SPECS) {
      expect(['shared', 'custom', 'none'], s.name).toContain(s.start);
      expect(typeof s.needsMail, s.name).toBe('boolean');
      expect(typeof s.needsClipboard, s.name).toBe('boolean');
      expect(Number.isInteger(s.timeoutMs) && s.timeoutMs > 0, `${s.name} timeoutMs`).toBe(true);
      if (s.start === 'shared') expect(s.why, s.name).toBeUndefined();
      else expect((s.why ?? '').trim().length, `${s.name} why`).toBeGreaterThan(20);
      if (s.serialGroup !== undefined) expect(typeof s.serialGroup).toBe('string');
    }
  });
});

describe('the rows tell the truth about their sources', () => {
  it('3. start: shared ⇔ the gate imports lib/start-doc.mjs', () => {
    for (const name of onDisk) {
      const shared = /lib\/start-doc\.mjs/.test(source(name));
      expect(specFor(name).start === 'shared', `${name}: shared=${shared}`).toBe(shared);
    }
  });
  it('4. needsMail ⇔ the gate reads the mail sink; needsClipboard ⇔ it drives the clipboard; clipboard gates share a serial group', () => {
    for (const name of onDisk) {
      const src = source(name); const spec = specFor(name);
      expect(spec.needsMail, `${name} needsMail`).toBe(MAIL.test(src));
      expect(spec.needsClipboard, `${name} needsClipboard`).toBe(/clipboard/i.test(src));
      if (spec.needsClipboard) expect(spec.serialGroup, `${name} serialGroup`).toBe('clipboard');
    }
  });
  it('5. checkManifest names every missing row and every orphan row in one error, and is silent when they match', () => {
    const rows = [{ name: 'a' }, { name: 'zzz-orphan' }];
    let message = '';
    try { checkManifest(['a', 'b-missing'], rows); } catch (e) { message = String(e); }
    expect(message).toContain('b-missing');
    expect(message).toContain('zzz-orphan');
    expect(() => checkManifest(['a', 'b'], [{ name: 'b' }, { name: 'a' }])).not.toThrow();
  });
  it('6. the runner consults the manifest: bijection at startup, per-gate timeout, serial groups, mail only when needed', () => {
    const runner = readFileSync(path.join(SCRIPTS, 'gates.mjs'), 'utf8');
    expect(runner).toMatch(/from '\.\/gates\.manifest\.mjs'/);
    expect(runner).toMatch(/checkManifest\(/);
    expect(runner).toMatch(/timeoutMs/);
    expect(runner).toMatch(/serialGroup/);
    expect(runner).toMatch(/needsMail/);
    const listed = execFileSync(process.execPath, [path.join(SCRIPTS, 'gates.mjs'), '--list'], { encoding: 'utf8' }).trim().split('\n').sort();
    expect(listed).toEqual(onDisk);
  });
});
