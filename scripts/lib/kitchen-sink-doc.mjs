/**
 * THE KITCHEN SINK as a published document, for gates: its three data refs
 * (a dataset, a viz recipe, an image) and a PDF, then the markup built from
 * the SOURCE OF TRUTH, lib/publish/fixtures/kitchen-sink.ts — the registry drift gate's
 * definition of "every component".
 *
 * `publish(body) → { id }` is the caller's door (a bearer `POST /api/artifacts`,
 * or `publishAs` for a signed-in browser), so the refs belong to whoever
 * publishes the document.
 */
import { execFileSync } from 'node:child_process';
import { samplePdf } from './sample-pdf.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Publish the refs and return the kitchen sink's markup naming them. */
export async function kitchenSinkMarkup(publish) {
  const dataset = await publish({
    title: 'kit rows',
    dataset: [
      { month: '2026-01-01', region: 'NA', revenue: 120 },
      { month: '2026-02-01', region: 'NA', revenue: 160 },
      { month: '2026-01-01', region: 'EU', revenue: 90 },
      { month: '2026-02-01', region: 'EU', revenue: 140 },
      { month: '2026-01-01', region: 'APAC', revenue: 70 },
      { month: '2026-02-01', region: 'APAC', revenue: 110 },
    ],
  });
  const recipe = await publish({
    title: 'kit recipe',
    viz: {
      description: 'Line by series',
      engine: 'vega-lite',
      bindings: [
        { name: 'x', label: 'X', accepts: ['nominal', 'temporal'] },
        { name: 'y', label: 'Y', accepts: ['quantitative'] },
        { name: 'series', label: 'Series', accepts: ['nominal'] },
      ],
      template: {
        mark: 'line',
        encoding: {
          x: { field: '{{x}}', type: '{{x:kind}}' },
          y: { field: '{{y}}', type: 'quantitative' },
          color: { field: '{{series}}', type: 'nominal' },
        },
      },
    },
  });
  const image = await publish({ title: 'kit image', image: `data:image/png;base64,${PNG}` });
  // The file a <File> card links. Built by the same helper the pdf gate and the
  // unit tests use, so all three assert the same bytes.
  const pdf = await publish({ title: 'kit paper', pdf: `data:application/pdf;base64,${samplePdf(2).toString('base64')}` });
  // From the MODULE, not from slicing its source: a hand-rolled unescape of its
  // template literal breaks the moment a nested backtick appears.
  return execFileSync('npx', ['tsx', '-e',
    `import { kitchenSinkMarkup } from './services/app/lib/publish/fixtures/kitchen-sink.ts';` +
    `process.stdout.write(kitchenSinkMarkup(${JSON.stringify({ dataset: dataset.id, recipe: recipe.id, image: image.id, pdf: pdf.id })}));`,
  ], { encoding: 'utf8', cwd: new URL('../..', import.meta.url).pathname });
}
