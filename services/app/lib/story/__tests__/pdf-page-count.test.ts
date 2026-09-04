/**
 * The page scan is BOUNDED — the finding that sent milestone 3 back.
 *
 * This runs on the publish path, in the one event loop, over a 25 MB file a
 * stranger chose. The first implementation read the whole buffer into a latin1
 * string and then called `match(/…/g)`, which materialises every hit: measured
 * on a 25 MB file made of nothing but the token, 2,083,333 matches at 1.5 s of
 * blocking CPU and +210 MB RSS in review (109 ms / +87 MB on this machine with
 * a forced collection). Both numbers sit badly beside this milestone's own
 * thesis that a 25 MB PDF is never held whole.
 */
import { describe, expect, it } from 'vitest';
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

  it('is bounded on the worst case the cap and the sniff both admit', () => {
    // 25 MB of nothing but the token: two million pages, all legal input.
    const token = '/Type /Page ';
    const worst = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from(token.repeat(Math.floor(25_000_000 / token.length))),
    ]);

    const before = process.memoryUsage();
    const started = process.hrtime.bigint();
    const pages = pdfPageCount(worst);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const heapDelta = process.memoryUsage().heapUsed - before.heapUsed;

    // A number it stopped counting is not a number.
    expect(pages).toBeUndefined();
    // The old shape took 109 ms here and 1.5 s in review; this stops after ten
    // thousand hits. A wide bound, because a loaded machine is the normal case.
    expect(ms).toBeLessThan(200);
    // And allocates essentially nothing: no 25 MB string, no array of matches.
    // The old shape held ~105 MB of matched strings at its peak.
    expect(heapDelta).toBeLessThan(10 * 1024 * 1024);
  });

  it('scans a big file with ordinary contents without holding it as a string', () => {
    // 20 MB of binary with 300 real page objects spread through it — the shape
    // of an actual large PDF, where a count IS wanted.
    const chunk = Buffer.alloc(64 * 1024, 0x41);
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
    for (let i = 0; i < 300; i += 1) parts.push(chunk, Buffer.from('/Type /Page\n'));
    const big = Buffer.concat(parts);
    expect(big.byteLength).toBeGreaterThan(19_000_000);

    const before = process.memoryUsage().heapUsed;
    expect(pdfPageCount(big)).toBe(300);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(10 * 1024 * 1024);
  });
});
