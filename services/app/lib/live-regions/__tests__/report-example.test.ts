/**
 * The skill's report example, read from disk (so this file stays out of the fast lane, which refuses file reads):
 * its sections hold svg, a button and layout divs, so none of them can be a region as written.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSource } from '../../html-page/html-source';
import { LiveRegionRefusal, normalizeRegionHtml } from '..';

it('the report example\'s sections cannot be regions as written: svg, button and div are refused', () => {
  const report = readFileSync(new URL('../../../skills/artifactbin/examples/report.html', import.meta.url), 'utf8');
  const document = parseSource(report);
  const sections = document.elements.filter((element) => element.tagName === 'section' || element.tagName === 'article');
  expect(sections.length).toBeGreaterThanOrEqual(2);
  const details = sections.flatMap((element) => {
    const location = element.sourceCodeLocation!;
    try { normalizeRegionHtml('rich', report.slice(location.startTag!.endOffset, location.endTag!.startOffset)); return []; } catch (error) {
      if (!(error instanceof LiveRegionRefusal)) throw error;
      return [...error.details];
    }
  });
  expect(details).toEqual(expect.arrayContaining(['<svg>', '<button>', '<div>']));
});

