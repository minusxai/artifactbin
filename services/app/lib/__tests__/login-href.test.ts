/** Every door to /login leads back to the address the person left — path, query and hash. */
import { describe, expect, it } from 'vitest';
import { loginHref } from '@/lib/login-href';
import { internalRedirectTarget } from '@/lib/safe-redirect';

const back = (href: string) => internalRedirectTarget(new URL(href, 'https://app.test').searchParams.get('callbackUrl'), 'https://app.test');

describe('loginHref', () => {
  it('returns to the artifact with the reader’s `$` values and hash intact', () => {
    const at = { pathname: '/@sam/ab12cd-split-tracker', search: '?$exp_desc=Dinner&$exp_amount=500', hash: '#ledger' };
    expect(back(loginHref(at))).toBe('/@sam/ab12cd-split-tracker?$exp_desc=Dinner&$exp_amount=500#ledger');
  });

  it('adds the intent without disturbing the other parameters', () => {
    const at = { pathname: '/a/ab12cd', search: '?$region=EU&intent=fork', hash: '' };
    expect(back(loginHref(at, 'like'))).toBe('/a/ab12cd?$region=EU&intent=like');
  });

  it('always carries an intent, wherever it was asked', () => {
    expect(back(loginHref({ pathname: '/', search: '', hash: '' }, 'fork'))).toBe('/?intent=fork');
  });

  it('is the bare /login where there is nowhere to come back to', () => {
    expect(loginHref({ pathname: '/', search: '', hash: '' })).toBe('/login');
    expect(loginHref({ pathname: '/login', search: '?callbackUrl=%2Fa%2Fab12cd', hash: '' })).toBe('/login');
  });
});
