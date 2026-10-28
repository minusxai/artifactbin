/**
 * Flagged by CodeQL on the login form's post-auth bounce, and it was a real
 * open redirect: the guard was `callbackUrl.startsWith('/')`, which `//evil.com`
 * satisfies while browsers read it as `https://evil.com`. A phishing link to
 * /login?callbackUrl=//evil.com would have landed a freshly-authenticated user
 * on an attacker's page.
 */
import { describe, it, expect } from 'vitest';
import { internalRedirectTarget, loginRedirectTarget } from '@/lib/http';

const ORIGIN = 'https://artifactbin.dev';
const target = (raw: string | null | undefined) => internalRedirectTarget(raw, ORIGIN);

describe('internalRedirectTarget — what it allows', () => {
  it('keeps a plain internal path', () => {
    expect(target('/tokens')).toBe('/tokens');
  });

  it('preserves query and hash (the OAuth bounce carries both)', () => {
    expect(target('/oauth/authorize?client_id=x&state=y')).toBe('/oauth/authorize?client_id=x&state=y');
    expect(target('/a/abc123#edit')).toBe('/a/abc123#edit');
  });

  it('accepts an absolute URL that is genuinely ours, reduced to a path', () => {
    expect(target(`${ORIGIN}/tokens?a=1`)).toBe('/tokens?a=1');
  });
});

describe('internalRedirectTarget — what it refuses', () => {
  it('refuses a PROTOCOL-RELATIVE url, the bug CodeQL caught', () => {
    // Starts with '/', so the old startsWith('/') guard let it straight through.
    expect(target('//evil.com')).toBe('/');
    expect(target('//evil.com/path')).toBe('/');
  });

  it('refuses backslash variants engines normalise to //', () => {
    expect(target('/\\evil.com')).toBe('/');
    expect(target('/\\/evil.com')).toBe('/');
  });

  it('refuses another origin outright', () => {
    expect(target('https://evil.com/x')).toBe('/');
    expect(target('http://artifactbin.dev.evil.com')).toBe('/');
  });

  it('refuses non-http schemes', () => {
    expect(target('javascript:alert(1)')).toBe('/');
    expect(target('data:text/html,<script>alert(1)</script>')).toBe('/');
  });

  it('falls back to home for nothing at all', () => {
    expect(target(null)).toBe('/');
    expect(target(undefined)).toBe('/');
    expect(target('')).toBe('/');
  });
});

const loopback = '/oauth/loopback?redirect_uri=http%3A%2F%2F127.0.0.1%3A9987%2Fcallback&state=test';
describe('login destinations', () => {
 it('keeps CLI callbacks out of ordinary website login', () => {
  expect(loginRedirectTarget(loopback, ORIGIN)).toBe('/');
  expect(loginRedirectTarget('/login/cli?callbackUrl='+encodeURIComponent(loopback), ORIGIN)).toBe('/');
 });
 it('refuses retired and external login destinations', () => {
  expect(loginRedirectTarget(loopback, ORIGIN)).toBe('/');
  expect(loginRedirectTarget('http://127.0.0.1:9987/callback', ORIGIN)).toBe('/');
 });
 it('keeps website document and consent continuations', () => {
  expect(loginRedirectTarget('/a/abc123?x=1#edit', ORIGIN)).toBe('/a/abc123?x=1#edit');
  expect(loginRedirectTarget('/oauth/authorize?client_id=test', ORIGIN)).toBe('/oauth/authorize?client_id=test');
 });
});
