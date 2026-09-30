/**
 * The document shapes the page-speed lab (scripts/performance-loads.mjs)
 * views: prose, a few kit components, a dashboard (CSV dataset + queries +
 * charts), a deck, a Mermaid diagram (plain and in a theme), and the kitchen sink.
 * Markup is stored without frontmatter;
 * the dashboard's `ref:{{sales}}` is replaced with the id of the dataset
 * published from sales.csv, and prose's `{{link}}` is replaced with a second,
 * unrelated document's id — a real same-deployment `<a href>` (size target 3
 * must measure a linked document's compiled page the way a real one names
 * its own link hints, never zero of them).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { kitchenSinkMarkup } from '../../lib/kitchen-sink-doc.mjs';

const here = import.meta.dirname;
const read = (file) => readFileSync(path.join(here, file), 'utf8');

/** `painted` names the DOM state that means the fixture's heaviest content is drawn. */
export const PAGE_SPEED_FIXTURES = [
  { key: 'prose', title: 'Perf A prose', template: null, file: 'prose.jsx', painted: null },
  { key: 'kit', title: 'Perf B kit', template: null, file: 'kit.jsx', painted: null },
  { key: 'dashboard', title: 'Perf C dashboard', template: 'dashboard', file: 'dashboard.jsx', painted: { charts: 2 } },
  { key: 'deck', title: 'Perf D deck', template: 'deck', file: 'deck.jsx', painted: null },
  { key: 'mermaid', title: 'Perf E mermaid', template: null, file: 'mermaid.jsx', painted: { diagrams: 1 } },
  // The same diagram in a theme's web fonts. The plain one has no theme, so it draws in system fonts,
  // which a stored drawing cannot carry: it always draws with the engine. This one is what a stored
  // drawing (services/app lib/mermaid-images) is made of.
  { key: 'mermaid-industry', title: 'Perf F mermaid, industry theme', template: null, theme: 'industry', file: 'mermaid.jsx', painted: { diagrams: 1 } },
  { key: 'kitchen', title: 'Perf G kitchen sink', template: null, painted: { charts: 1 } },
];

/**
 * Publish every fixture through `publish(body) → { id }` (POST /api/artifacts
 * with a bearer token). Returns the fixtures with their new ids.
 */
export async function publishPageSpeedFixtures(publish, visibility = 'unlisted') {
  const sales = await publish({ title: 'Perf sales', dataset: read('sales.csv'), visibility });
  // Published up front so prose's `{{link}}` resolves to a real id: the page-speed prose fixture
  // otherwise never exercises link hints, so a regression that makes them fetch eagerly (rather
  // than waiting for hover/press intent) has nothing to measure size target 3 against.
  const linkTarget = await publish({ title: 'Perf link target', markup: '<p id="link-target-body">A second document the prose fixture links to.</p>', visibility });
  const published = [];
  for (const fixture of PAGE_SPEED_FIXTURES) {
    const markup = fixture.key === 'kitchen'
      // The seed checks for unresolved {{...}} placeholders; JSX object props
      // from the source use the same bytes, so space their braces equivalently.
      ? (await kitchenSinkMarkup(publish)).replaceAll('={{', '={ {')
      : read(fixture.file).replaceAll('{{sales}}', sales.id).replaceAll('{{link}}', linkTarget.id);
    const made = await publish({ title: fixture.title, markup, visibility, ...(fixture.template ? { template: fixture.template } : {}), ...(fixture.theme ? { theme: fixture.theme } : {}) });
    published.push({ ...fixture, id: made.id });
  }
  return published;
}
