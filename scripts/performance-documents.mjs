/**
 * The page-speed lab's DOCUMENT VIEWS against a server that is already running,
 * so fixtures and DOM markers can be checked on this checkout's dev server
 * before CI runs the paired production-build lab (scripts/performance-loads.mjs).
 * Numbers from a dev server are not benchmarks: Vite serves unbundled modules.
 *
 *   usage: node scripts/performance-documents.mjs <base> [runs=1] [output.json] [--no-throttle]
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { connectAgent } from './lib/cli-connection.mjs';
import { publishPageSpeedFixtures } from './fixtures/page-speed/index.mjs';
import { LAB_THROTTLE, documentViewsMarkdown, measureDocumentViews, summarizeDocumentViews } from './lib/document-views.mjs';

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const [base = 'http://localhost:3030', runs = '1', output] = args;
const throttle = process.argv.includes('--no-throttle') ? null : LAB_THROTTLE;
const { token } = await connectAgent(base);
const fixtures = await publishPageSpeedFixtures(async body => {
  const response = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`publish ${body.title}: ${response.status} ${await response.text()}`);
  return response.json();
});
console.log(fixtures.map(f => `${f.key} ${base}/a/${f.id}`).join('\n'));
const browser = await chromium.launch({ headless: true });
try {
  const samples = await measureDocumentViews({ browser, base, fixtures, runs: Number(runs), throttle, log: line => console.log(line) });
  const summary = summarizeDocumentViews(samples);
  console.log(documentViewsMarkdown(summary));
  const errors = [...new Set(samples.flatMap(s => s.errors))];
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  if (output) writeFileSync(output, JSON.stringify({ fixtures, samples, summary }, null, 2));
  if (samples.some(s => !s.ready)) process.exitCode = 1;
} finally {
  await browser.close();
}
