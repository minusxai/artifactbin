import { afterEach, describe, expect, it } from 'vitest';
import { sniffFontType, webIngestAllowsHttp } from '..';
import { setWebIngestPolicyForTests } from '../fetch';

afterEach(() => setWebIngestPolicyForTests(null));
const bytes = (head: string | number[], rest = 16) => Buffer.concat([typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head), Buffer.alloc(rest)]);

describe('webIngestAllowsHttp', () => {
  it('follows the active policy: a test policy wins over configuration and clearing it restores configuration', () => {
    const configured = webIngestAllowsHttp();
    setWebIngestPolicyForTests({ allowPrivate: false, allowHttp: true });
    expect(webIngestAllowsHttp()).toBe(true);
    setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: false });
    expect(webIngestAllowsHttp()).toBe(false);
    setWebIngestPolicyForTests(null);
    expect(webIngestAllowsHttp()).toBe(configured);
  });
});

describe('sniffFontType', () => {
  it('recognizes WOFF2, WOFF, OpenType and every TrueType signature by magic bytes', () => {
    expect(sniffFontType(bytes('wOF2'))).toBe('font/woff2');
    expect(sniffFontType(bytes('wOFF'))).toBe('font/woff');
    expect(sniffFontType(bytes('OTTO'))).toBe('font/otf');
    expect(sniffFontType(bytes([0x00, 0x01, 0x00, 0x00]))).toBe('font/ttf');
    expect(sniffFontType(bytes('true'))).toBe('font/ttf');
    expect(sniffFontType(bytes('ttcf'))).toBe('font/ttf');
  });

  it('answers null for other files, truncated or empty buffers and case variants of a signature', () => {
    for (const buf of [bytes('<svg'), bytes([0x89, 0x50, 0x4e, 0x47]), Buffer.from('wOF'), Buffer.alloc(0), bytes('wof2'), bytes('WOF2'), bytes([0x00, 0x01, 0x00, 0x01]), Buffer.from([0x00, 0x01, 0x00])])
      expect(sniffFontType(buf)).toBeNull();
  });
});
