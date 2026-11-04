/** A page's name as its source states it (lib/html-page page-title): the first heading's text, and renaming <title> in place. */
import { describe, expect, it } from 'vitest';
import { firstHeadingText, withPageTitle } from '..';

describe('firstHeadingText', () => {
  it('reads the first body <h1> with its inline text, whitespace collapsed', () => {
    expect(firstHeadingText('<!doctype html><html><head><title>T</title></head><body><main><article><h1 data-af-id="a">Q3 <strong>plan</strong>\n now</h1><h1>Second</h1></article></main></body></html>')).toBe('Q3 plan now');
  });
  it('is empty for an empty heading, a page with none, and an <h1> only inside a template', () => {
    expect(firstHeadingText('<html><body><h1></h1></body></html>')).toBe('');
    expect(firstHeadingText('<html><body><h2>Not a title</h2></body></html>')).toBe('');
    expect(firstHeadingText('<html><body><template><h1>Hidden</h1></template></body></html>')).toBe('');
  });
});

describe('withPageTitle', () => {
  it('replaces only the title text, escaped, keeping every other byte', () => {
    const page = '<!doctype html>\n<html><head>\n  <title data-af-id="t">Untitled document</title>\n  <meta charset="utf-8"></head><body><h1>x</h1></body></html>';
    expect(withPageTitle(page, 'R&D <draft>')).toBe(page.replace('Untitled document', 'R&amp;D &lt;draft&gt;'));
  });
  it('adds a title at the head\'s start when the page has none', () => {
    expect(withPageTitle('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>', 'Plan')).toBe('<!doctype html><html><head><title>Plan</title><meta charset="utf-8"></head><body></body></html>');
  });
});
