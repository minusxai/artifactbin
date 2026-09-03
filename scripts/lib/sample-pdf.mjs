/**
 * A real, minimal PDF — built rather than committed, and built HERE so the unit
 * tests and the browser gate assert against the same bytes.
 *
 * Plain JS with no dependency, because the gate is a node script and the tests
 * are TypeScript: a fixture only one of them can build is a fixture the other
 * one quietly stops matching. Everything a viewer needs is present (catalog,
 * page tree, one content stream and one Type1 font per page, a real xref table
 * and trailer), which is what makes it a fair subject for "does this render".
 */

/** @param {string} s */
const bytes = (s) => Buffer.from(s, 'latin1');

/**
 * An `n`-page PDF whose pages read "Page 1 of n", …
 *
 * @param {number} pages
 * @returns {Buffer}
 */
export function samplePdf(pages = 3) {
  /** @type {string[]} */
  const objects = [];
  const pageIds = [];
  // 1 = catalog, 2 = page tree, then (page, content) per page, then the font.
  for (let i = 0; i < pages; i += 1) pageIds.push(3 + i * 2);
  const fontId = 3 + pages * 2;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  for (let i = 0; i < pages; i += 1) {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const text = `BT /F1 18 Tf 20 100 Td (Page ${i + 1} of ${pages}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${contentId} 0 R`
      + ` /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  /** @type {number[]} */
  const offsets = [];
  for (let id = 1; id <= fontId; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const startxref = out.length;
  out += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return bytes(out);
}

/** The same PDF as a `data:` URL, which is how the create door takes one. */
export const samplePdfDataUrl = (pages = 3) => `data:application/pdf;base64,${samplePdf(pages).toString('base64')}`;
