/**
 * The driver approves the agent's device pairing from the proxy LEDGER — its own file — because the
 * agent's `~/.artifactbin` is 0700 and unreadable under `--run-as`, which is how the not-installed
 * legs once polled a pairing for fifteen minutes with nobody approving. The driver-run setup keeps
 * its home-dir source. Each code is approved once; an expired pairing is left alone.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairingsFromHome, pairingsFromLedger, startApprover } from '../lib/approver';
import { DRIVER_HEADER } from '../lib/proxy';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const row = (extra: Record<string, unknown>) => JSON.stringify({ t: Date.now(), ms: 1, method: 'POST', path: '/oauth/device', status: 200, ua: 'node', auth: null, error: null, ...extra }) + '\n';

describe('pairing sources', () => {
  it('reads user codes and expiries off ledger rows, ignoring rows without one and unparseable lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approver-'));
    const ledger = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(ledger, row({ userCode: 'AAAA-1111', pairingExpiresAt: 42 }) + row({}) + 'not json\n' + row({ userCode: 'BBBB-2222' }));
    expect(pairingsFromLedger(ledger)).toEqual([{ code: 'AAAA-1111', expiresAt: 42 }, { code: 'BBBB-2222', expiresAt: null }]);
    expect(pairingsFromLedger(path.join(dir, 'missing.jsonl'))).toEqual([]);
  });
  it('reads the CLI\'s pending-pairing file from a readable home, and an unreadable home is simply empty', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'approver-home-'));
    fs.mkdirSync(path.join(home, '.artifactbin'));
    fs.writeFileSync(path.join(home, '.artifactbin', 'pairing-0123456789abcdef.json'), JSON.stringify({ userCode: 'CCCC-3333', expiresAt: 99 }));
    expect(pairingsFromHome(home)).toEqual([{ code: 'CCCC-3333', expiresAt: 99 }]);
    expect(pairingsFromHome(path.join(home, 'nope'))).toEqual([]);
  });
});

describe('startApprover', () => {
  it('approves each ledger pairing once through the agent\'s proxy with the driver\'s session, and skips an expired one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approver-'));
    const ledger = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(ledger, '');
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const approver = startApprover({
      ledgerPath: ledger, agentBase: 'http://proxy.test', publicOrigin: 'https://public.test', cookie: 'session=abc', intervalMs: 10,
      fetch: (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body), headers: init.headers as Record<string, string> }); return new Response('ok', { status: 200 }); }) as unknown as typeof fetch,
    });
    try {
      await tick();
      expect(calls).toEqual([]);
      fs.appendFileSync(ledger, row({ userCode: 'LIVE-0001', pairingExpiresAt: Date.now() + 60_000 }));
      fs.appendFileSync(ledger, row({ userCode: 'GONE-0002', pairingExpiresAt: Date.now() - 1 }));
      await tick(60);
      await tick(60);
      expect(calls.map((c) => c.body)).toEqual(['user_code=LIVE-0001&decision=approve']);
      expect(calls[0].url).toBe('http://proxy.test/oauth/device/approve');
      expect(calls[0].headers.Origin).toBe('https://public.test');
      expect(calls[0].headers.Cookie).toBe('session=abc');
      expect(calls[0].headers[DRIVER_HEADER]).toBe('1');
      expect(approver.approved).toEqual(['LIVE-0001']);
    } finally { approver.stop(); }
  });
});
