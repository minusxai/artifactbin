/**
 * How a FILE is presented to a person — the size and the name.
 *
 * The name half exists because of a reader-facing outage found in review:
 * `decodeURIComponent` THROWS on a lone `%`, and `50%off.pdf`, `100%.pdf` and
 * `a%ff.pdf` are ordinary filenames. Unguarded, one of them in a `<File src>`
 * published a document (with a warning, as designed) that then answered 500 to
 * every reader forever, and made `/assets/<hash>` 500 for a PDF that had
 * imported perfectly.
 */
import { describe, expect, it } from 'vitest';
import { fileNameFromUrl, formatFileSize } from '../file-display';

describe('formatFileSize', () => {
  it('reads the way a file manager does — decimal units, one decimal under ten', () => {
    expect(formatFileSize(0)).toBe('0 bytes');
    expect(formatFileSize(999)).toBe('999 bytes');
    expect(formatFileSize(1_116)).toBe('1.1 kB');
    expect(formatFileSize(2_400_000)).toBe('2.4 MB');
    expect(formatFileSize(25_000_000)).toBe('25 MB');
  });

  it('answers nothing for a number that is not a size', () => {
    expect(formatFileSize(Number.NaN)).toBe('');
    expect(formatFileSize(-1)).toBe('');
  });
});

describe('fileNameFromUrl', () => {
  it('is the last path segment, decoded, without the query or the fragment', () => {
    expect(fileNameFromUrl('https://x.test/papers/q3%20report.pdf?v=2#page=3')).toBe('q3 report.pdf');
    expect(fileNameFromUrl('/assets/deadbeef')).toBe('deadbeef');
  });

  it('KEEPS A MALFORMED ESCAPE AS TEXT rather than throwing — a lone % is an ordinary filename', () => {
    // Each of these throws URIError from a bare decodeURIComponent. A name is
    // decoration on a card; a throw here is a 500 for every reader of the
    // document, which is the one outcome that must not be possible.
    expect(fileNameFromUrl('https://x.test/50%off.pdf')).toBe('50%off.pdf');
    expect(fileNameFromUrl('https://x.test/100%.pdf')).toBe('100%.pdf');
    expect(fileNameFromUrl('https://x.test/a%ff.pdf')).toBe('a%ff.pdf');
    expect(fileNameFromUrl('https://x.test/%')).toBe('%');
  });

  it('answers null when there is no segment to name', () => {
    expect(fileNameFromUrl(null)).toBeNull();
    expect(fileNameFromUrl('')).toBeNull();
    expect(fileNameFromUrl('https://x.test/')).toBeNull();
    expect(fileNameFromUrl('https://x.test/?only=query')).toBeNull();
  });
});
