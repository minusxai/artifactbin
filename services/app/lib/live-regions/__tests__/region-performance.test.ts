/**
 * The cost bound for one large region: a 50,000-character paragraph built, read, revised and compacted in under
 * two seconds of this process's CPU time. Measured as CPU, not wall time, and kept out of the fast lane, whose
 * parallel runners and 2 s per-test limit made a wall-clock bound fail on load rather than on cost.
 */
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '../../html-page';
import { attribute, parseSource } from '../../html-page/html-source';
import { applyRegionRevision, compactRegion, createRegionState, normalizeRegionHtml, regionHtml } from '..';

function published(region: string) {
  const page = canonicalizeHtmlPage(`<!doctype html><html><head><title>Plan</title></head><body><article data-af-editable="rich">${normalizeRegionHtml('rich', region)}</article></body></html>`);
  const element = parseSource(page.html).elements.find((candidate) => attribute(candidate, 'data-af-editable') === 'rich')!;
  const location = element.sourceCodeLocation!;
  return { ...page, regionId: attribute(element, 'data-af-id')!, inner: page.html.slice(location.startTag!.endOffset, location.endTag!.startOffset) };
}

it('a 50,000-character paragraph is built, read, revised and compacted in under two CPU seconds', () => {
  const long = 'word '.repeat(10_000).trim();
  const cpu = process.cpuUsage();
  const saved = published(`<p>${long}</p>`);
  const { state, snapshot } = createRegionState('rich', saved.inner);
  expect(regionHtml('rich', state)).toContain(long);
  const { update } = applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: snapshot, html: saved.inner.replace('word word', 'WORD word') });
  const page = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: Y.mergeUpdates([state, update]) });
  expect(page.html).toContain('WORD word');
  const used = process.cpuUsage(cpu);
  expect((used.user + used.system) / 1000).toBeLessThan(2000);
}, 20_000);
