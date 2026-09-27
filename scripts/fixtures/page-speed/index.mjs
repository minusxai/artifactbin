/**
 * The document shapes the page-speed lab (scripts/performance-loads.mjs)
 * views: prose, a few kit components, a dashboard (CSV dataset + queries +
 * charts), a deck and a Mermaid diagram, plain and in a theme. Markup is stored without frontmatter;
 * the dashboard's `ref:{{sales}}` is replaced with the id of the dataset
 * published from sales.csv.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
];

/**
 * Publish every fixture through `publish(body) → { id }` (POST /api/artifacts
 * with a bearer token). Returns the fixtures with their new ids.
 */
export async function publishPageSpeedFixtures(publish, visibility = 'unlisted') {
  const sales = await publish({ title: 'Perf sales', dataset: read('sales.csv'), visibility });
  const published = [];
  for (const fixture of PAGE_SPEED_FIXTURES) {
    const markup = read(fixture.file).replaceAll('{{sales}}', sales.id);
    const made = await publish({ title: fixture.title, markup, visibility, ...(fixture.template ? { template: fixture.template } : {}), ...(fixture.theme ? { theme: fixture.theme } : {}) });
    published.push({ ...fixture, id: made.id });
  }
  return published;
}
