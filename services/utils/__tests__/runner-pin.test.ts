/** The runner pin's caller: signed with the rest of the pin, so neither resolver code nor a forger can change who called. */
import { describe, expect, it } from 'vitest';
import { signActor, verifyActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';

const SECRET = 's'.repeat(32);
const pin = (caller?: unknown): Actor => ({ credential: 'session', userId: 'owner1',
  runner: { pageBackendOperation: 'query', runId: 'run1', callId: 1, artifactId: 'backend1', version: 'v1', editId: 'v1', sourceHash: 'h', ...(caller === undefined ? {} : { caller }) } as Actor['runner'] });
const reencode = (header: string, edit: (claims: Record<string, any>) => void) => {
  const [payload, signature] = header.split('.');
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
  edit(claims);
  return `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
};

describe('runner pin caller', () => {
  it('round-trips the caller, an anonymous one included', () => {
    expect(verifyActor(signActor(pin({ subject: 'viewer1', role: 'viewer' }), SECRET), SECRET)?.runner?.caller).toEqual({ subject: 'viewer1', role: 'viewer' });
    expect(verifyActor(signActor(pin({ subject: null, role: 'anonymous' }), SECRET), SECRET)?.runner?.caller).toEqual({ subject: null, role: 'anonymous' });
  });
  it('refuses a tampered caller: the signature covers it', () => {
    const header = signActor(pin({ subject: 'viewer1', role: 'viewer' }), SECRET);
    expect(verifyActor(reencode(header, (c) => { c.runner.caller.role = 'owner'; }), SECRET)).toBeNull();
    expect(verifyActor(reencode(header, (c) => { c.runner.caller.subject = 'owner1'; }), SECRET)).toBeNull();
    expect(verifyActor(reencode(header, (c) => { delete c.runner.caller; }), SECRET)).toBeNull();
    expect(verifyActor(signActor(pin({ subject: 'viewer1', role: 'viewer' }), 'x'.repeat(32)), SECRET)).toBeNull();
  });
  it('refuses a malformed caller even when signed', () => {
    for (const caller of [{ subject: 'u', role: 'admin' }, { subject: '', role: 'viewer' }, { subject: 7, role: 'viewer' }, { subject: 'u', role: 'viewer', extra: 1 }, null, 'viewer', ['u', 'viewer']])
      expect(verifyActor(signActor(pin(caller), SECRET), SECRET), JSON.stringify(caller)).toBeNull();
  });
  it('still verifies a pin with no caller (a runner that predates it)', () => {
    const actor = verifyActor(signActor(pin(), SECRET), SECRET);
    expect(actor?.runner?.artifactId).toBe('backend1');
    expect(actor?.runner && 'caller' in actor.runner).toBe(false);
  });
});
