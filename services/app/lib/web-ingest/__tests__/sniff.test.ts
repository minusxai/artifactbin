/**
 * Byte sniffing: the remote Content-Type header is attacker-controlled, so
 * what we store is typed by what the BYTES say. A mismatch is a refusal, not
 * a trusted header.
 */
import { describe, expect, it } from 'vitest';
import { samplePdf } from '../../../../../scripts/lib/sample-pdf.mjs';
import { isWoff2, sniffAssetType, sniffImageType } from '../sniff';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const gif = Buffer.from('GIF89a\x01\x00');
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('sniffImageType', () => {
  it('identifies the four raster formats by magic bytes', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(gif)).toBe('image/gif');
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('identifies svg through leading whitespace, BOM, xml decl and comments', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(sniffImageType(Buffer.from('  \n<?xml version="1.0"?>\n<!-- hi -->\n<svg/>'))).toBe('image/svg+xml');
    expect(sniffImageType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<svg/>')]))).toBe('image/svg+xml');
  });

  it('refuses html pretending to be an image — the error page a dead link serves', () => {
    expect(sniffImageType(Buffer.from('<!doctype html><html><body>404</body></html>'))).toBeNull();
    expect(sniffImageType(Buffer.from('<html><svg></svg></html>'))).toBeNull();
  });

  it('refuses truncated magic, empty buffers, and plain text', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from('hello'))).toBeNull();
    // RIFF that is not WEBP (a .wav file).
    expect(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]))).toBeNull();
  });
});

describe('isWoff2', () => {
  it('accepts the wOF2 magic and nothing else', () => {
    expect(isWoff2(Buffer.from('wOF2\x00\x01'))).toBe(true);
    expect(isWoff2(Buffer.from('wOFF\x00\x01'))).toBe(false); // woff1 — not what google serves us
    expect(isWoff2(Buffer.from('OTTO'))).toBe(false);
    expect(isWoff2(Buffer.alloc(0))).toBe(false);
  });
});

/*
 * The tier's whole safety story is "the type comes from the bytes", and the
 * image sniffer is image-only by construction — it does not know `%PDF-`
 * (measured in the spike, S4). sniffAssetType is the one that knows both, and
 * it knows nothing else: an asset we do not serve is not a type we sniff.
 */
describe('sniffAssetType', () => {
  it('names a PDF by its signature', () => {
    expect(sniffAssetType(samplePdf(1))).toBe('application/pdf');
    expect(sniffAssetType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
  });

  it('still answers every image type the image sniffer knows', () => {
    expect(sniffAssetType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffAssetType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
  });

  it('refuses what it does not know — a name is never guessed from an extension', () => {
    expect(sniffAssetType(Buffer.from('<!doctype html><h1>404</h1>'))).toBeNull();
    expect(sniffAssetType(Buffer.from('wOF2'))).toBeNull(); // a font is not an asset this tier serves
    expect(sniffAssetType(Buffer.alloc(0))).toBeNull();
  });

  it('a PDF named .png is refused as an image and accepted as a PDF — the extension never decides', () => {
    const pdf = samplePdf(1);
    expect(sniffImageType(pdf)).toBeNull();
    expect(sniffAssetType(pdf)).toBe('application/pdf');
  });

  it('is not fooled by %PDF- appearing later in the file', () => {
    expect(sniffAssetType(Buffer.concat([Buffer.from('<!doctype html>'), samplePdf(1)]))).toBeNull();
  });
});
