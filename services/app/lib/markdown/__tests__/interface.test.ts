import { describe, expect, it } from 'vitest';
import { markdownContent } from '../content';

const linkErrors = (href: string) => markdownContent(`[x](<${href}>)`).errors;

describe('markdown links', () => {
  it('accepts relative, fragment and web/mail/phone links', () => {
    for (const href of ['/docs', 'page.md', '#section', '?q=1', 'https://example.com', 'HTTP://EXAMPLE.COM', 'mailto:a@b.c', 'tel:+15551234']) expect(linkErrors(href), href).toEqual([]);
  });

  it('refuses executable and other schemes, including ones hidden by whitespace or control characters', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '\x01javascript:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://host'])
      expect(linkErrors(href), JSON.stringify(href)).toEqual(['Markdown links require a safe URL (http, https, mailto, tel, or a relative URL).']);
  });
});
