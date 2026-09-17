/**
 * link-edit — what a user-typed URL is allowed to become.
 *
 * The toolbar, the edit session and the clipboard paths all normalize here
 * before an href reaches a document, so an active-content scheme is refused
 * where it is typed rather than saved and silently stripped later.
 */
import { normalizeLinkHref } from '../link-edit';

describe('normalizeLinkHref', () => {
  it('passes absolute http(s)/mailto/tel through', () => {
    expect(normalizeLinkHref('https://example.com/x?y=1')).toBe('https://example.com/x?y=1');
    expect(normalizeLinkHref('http://example.com')).toBe('http://example.com');
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(normalizeLinkHref('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('gives a bare domain https://', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com');
    expect(normalizeLinkHref('docs.example.co/path#frag')).toBe('https://docs.example.co/path#frag');
  });

  it('keeps site-relative and fragment forms', () => {
    expect(normalizeLinkHref('/a/abc123')).toBe('/a/abc123');
    expect(normalizeLinkHref('#section')).toBe('#section');
  });

  it('rejects active-content schemes and unrecognizable input', () => {
    expect(normalizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('data:text/html,x')).toBeNull();
    expect(normalizeLinkHref('vbscript:x')).toBeNull();
    expect(normalizeLinkHref('   ')).toBeNull();
    expect(normalizeLinkHref('not a url')).toBeNull();
  });

  it('lowercases the scheme, which is case-insensitive, and leaves the rest alone', () => {
    // Downstream compares against literal prefixes (the frame re-checks before
    // it writes the attribute), so a scheme that only differs in case must not
    // read as a different scheme and silently drop the link.
    expect(normalizeLinkHref('HTTPS://Example.com/Path?A=B')).toBe('https://Example.com/Path?A=B');
    expect(normalizeLinkHref('MailTo:A@B.com')).toBe('mailto:A@B.com');
    expect(normalizeLinkHref('TEL:+15551234567')).toBe('tel:+15551234567');
  });

  it('trims whitespace before classifying', () => {
    expect(normalizeLinkHref('  example.com  ')).toBe('https://example.com');
  });
});
