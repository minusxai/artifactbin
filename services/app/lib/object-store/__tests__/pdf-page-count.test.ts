/**
 * The page scan is BOUNDED.
 *
 * This runs on the publish path, in the one event loop, over a 25 MB file a
 * stranger chose. Reading the whole buffer into a latin1 string and calling
 * `match(/…/g)` materialises every hit: measured on a 25 MB file made of
 * nothing but the token, 2,083,333 matches at 1.5 s of blocking CPU and
 * +210 MB RSS in review (109 ms / +87 MB on this machine with a forced
 * collection). Both numbers sit badly beside the tier's own thesis that a
 * 25 MB PDF is never held whole.
 */
import { describe, expect, it, vi } from 'vitest';
import { samplePdf } from '../../../../../scripts/lib/sample-pdf.mjs';
import { pdfPageCount } from '../pdf-store';

describe('pdfPageCount', () => {
  it('counts the leaves of a real file, not the page tree', () => {
    expect(pdfPageCount(samplePdf(1))).toBe(1);
    expect(pdfPageCount(samplePdf(3))).toBe(3);
    expect(pdfPageCount(samplePdf(12))).toBe(12);
    // `/Type /Pages` is the TREE. samplePdf carries exactly one, so a count
    // that included it would be off by one on every file.
    expect(samplePdf(3).toString('latin1')).toContain('/Type /Pages');
  });

  it('says nothing when the file does not say it in the clear', () => {
    expect(pdfPageCount(Buffer.from('%PDF-1.7\nobject streams all the way down'))).toBeUndefined();
    expect(pdfPageCount(Buffer.alloc(0))).toBeUndefined();
  });

  it('tolerates the whitespace a PDF may put between the names', () => {
    expect(pdfPageCount(Buffer.from('/Type/Page /Type\n/Page /Type  /Page'))).toBe(3);
  });

  it('never throws on a token that runs off the end of the file', () => {
    /*
     * A `/Type` in the last few bytes has no room for the `/Page` after it, and
     * the buffer walk compared past the end — `RangeError: sourceEnd is out of
     * range`. It runs on the PUBLISH path, so a truncated upload (or any file
     * whose last token lands near EOF) would have been a 500 on create: the
     * same class of bug as the `%`-in-a-filename 500, introduced by the fix for
     * the unbounded scan.
     */
    for (const tail of ['/Type /Pag', '/Type', '/Type /', '/Type /P', '/Typ']) {
      expect(() => pdfPageCount(Buffer.from(tail)), tail).not.toThrow();
      expect(pdfPageCount(Buffer.from(tail)), tail).toBeUndefined();
    }
    // …and a whole one at the very end still counts.
    expect(pdfPageCount(Buffer.from('%PDF-1.4 /Type /Page'))).toBe(1);
  });

  it('reads the page TREE as the tree, spaced or not', () => {
    // `/Type/Pages` is the node that holds the leaves; counting it would put
    // every file one page over.
    expect(pdfPageCount(Buffer.from('/Type/Pages'))).toBeUndefined();
    expect(pdfPageCount(Buffer.from('/Type /Pages'))).toBeUndefined();
    expect(pdfPageCount(Buffer.from('/Type/Pages /Type/Page'))).toBe(1);
  });

  it('is bounded on the worst case the cap and the sniff both admit', () => {
    // 25 MB of nothing but the token: two million pages, all legal input.
    const token = '/Type /Page ';
    const worst = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from(token.repeat(Math.floor(25_000_000 / token.length))),
    ]);

    // Counted, not timed: every look is one `indexOf`, so a scan that stops after ten thousand hits makes about that
    // many (the old shape looked at all two million); and it never turns the bytes into a string.
    const looks = vi.spyOn(worst, 'indexOf'), asText = vi.spyOn(worst, 'toString');
    const pages = pdfPageCount(worst);

    // A number it stopped counting is not a number.
    expect(pages).toBeUndefined();
    expect(looks.mock.calls.length).toBeLessThanOrEqual(10_002);
    expect(asText).not.toHaveBeenCalled();
  });

  it('scans a big file with ordinary contents without holding it as a string', () => {
    // 20 MB of binary with 300 real page objects spread through it — the shape
    // of an actual large PDF, where a count IS wanted.
    const chunk = Buffer.alloc(64 * 1024, 0x41);
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
    for (let i = 0; i < 300; i += 1) parts.push(chunk, Buffer.from('/Type /Page\n'));
    const big = Buffer.concat(parts);
    expect(big.byteLength).toBeGreaterThan(19_000_000);

    const asText = vi.spyOn(big, 'toString');
    expect(pdfPageCount(big)).toBe(300);
    expect(asText).not.toHaveBeenCalled();
  });
});
