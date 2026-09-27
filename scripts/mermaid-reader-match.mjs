/**
 * WHICH READERS MEASURE A FACE AS THE HARVEST DOES — the table the server
 * offers stored Mermaid drawings by (services/app/lib/mermaid-images/readers).
 *
 * A stored drawing is laid out in what the harvest's browser (Linux Chromium,
 * unhinted text) measured the palette's faces as; a reader keeps it only while
 * it measures them the same (lib/mermaid-images/match), and otherwise draws
 * with the engine. The server cannot measure a reader, so it offers stored
 * drawings only where this table, MEASURED, says the reader's class agrees with
 * the harvest for the drawing's label face at its size and edge-label face at
 * 11px. Measured on 27 Sep 2026: Blink on macOS agrees with the harvest for
 * some faces and sizes and not others (line-box heights and per-font advance
 * rounding differ) — so it is a table, not a rule. A class or face not in it is
 * never offered stored drawings; if a browser release moves its metrics, its
 * readers find the drawing is not theirs and draw with the engine (downloading
 * both) until the table is measured again.
 *
 *   1. node scripts/mermaid-reader-match.mjs measure <base> <out.json> [--harvest]
 *      Every family of the story font manifest at 11–16px, measured as the kit
 *      measures a palette (SVG text box of METRICS_PROBE), in this machine's
 *      Chromium; `--harvest` launches it as the harvest does (unhinted). <base>
 *      is a running app serving /fonts. Run once as the harvest (on Linux, e.g.
 *      the mcr.microsoft.com/playwright image of the pinned version) and once as
 *      each reader class (on its OS).
 *   2. node scripts/mermaid-reader-match.mjs table <harvest.json> <class>=<reader.json>...
 *      Writes services/app/lib/mermaid-images/reader-match.json. Never edit it by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(root, 'services/app/lib/mermaid-images/reader-match.json');
const SIZES = [11, 12, 13, 14, 15, 16];
const [command, ...args] = process.argv.slice(2);

async function probe() {
  // The one probe the kit measures with (lib/mermaid-images/match), however this script is run.
  const text = readFileSync(path.join(root, 'services/app/lib/mermaid-images/match.ts'), 'utf8');
  const found = /export const METRICS_PROBE = '([^']+)';/.exec(text);
  if (!found) throw new Error('METRICS_PROBE not found in lib/mermaid-images/match.ts');
  return found[1];
}

async function measure(base, out, harvest) {
  const playwright = (await import(process.env.PLAYWRIGHT ?? 'playwright')).default;
  const manifest = JSON.parse(readFileSync(path.join(root, 'services/app/lib/data/story/story-font-manifest.json'), 'utf8'));
  const text = await probe();
  const browser = await playwright.chromium.launch({ args: harvest ? ['--font-render-hinting=none'] : [] });
  try {
    const page = await browser.newPage();
    // Any page of the app's origin: the fonts are served beside it.
    await page.goto(`${base}/a/mermaid-reader-match/raw`, { waitUntil: 'domcontentloaded' });
    const css = Object.values(manifest.families).flat().map((face) => `@font-face { font-family: "${face.family}"; src: url(${face.url}) format("woff2"); font-weight: ${face.weight}; font-style: ${face.style ?? 'normal'};${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ''} }`).join('\n');
    await page.addStyleTag({ content: css });
    const faces = await page.evaluate(async ({ families, sizes, text }) => {
      const result = {};
      for (const family of families) {
        await Promise.all(sizes.map((size) => document.fonts.load(`${size}px "${family}"`, text)));
        result[family] = {};
        for (const size of sizes) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden;');
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('style', `font-family: "${family}", sans-serif; font-size: ${size}px;`);
          label.textContent = text;
          svg.appendChild(label);
          document.body.appendChild(svg);
          const box = label.getBBox();
          result[family][size] = [box.width, box.height, box.y];
          svg.remove();
        }
      }
      return result;
    }, { families: Object.keys(manifest.families), sizes: SIZES, text });
    const who = `Chromium ${browser.version()} on ${process.platform}/${process.arch}${harvest ? ', unhinted (--font-render-hinting=none)' : ''}`;
    writeFileSync(out, JSON.stringify({ who, probe: createHash('sha256').update(text).digest('hex').slice(0, 16), faces }, null, 1));
    console.log(`measured ${Object.keys(faces).length} families × ${SIZES.length} sizes: ${who}`);
  } finally {
    await browser.close();
  }
}

async function table(harvestFile, readers) {
  const { tsImport } = await import('tsx/esm/api');
  const { mermaidBoxesAgree } = await tsImport('../services/app/lib/mermaid-images/match.ts', import.meta.url);
  const harvest = JSON.parse(readFileSync(harvestFile, 'utf8'));
  const probeHash = createHash('sha256').update(await probe()).digest('hex').slice(0, 16);
  if (harvest.probe !== probeHash) throw new Error(`${harvestFile} was measured with another probe`);
  const classes = {};
  for (const spec of readers) {
    const [name, file] = spec.split('=');
    const reader = JSON.parse(readFileSync(file, 'utf8'));
    if (reader.probe !== probeHash) throw new Error(`${file} was measured with another probe`);
    const faces = {};
    for (const [family, sizes] of Object.entries(harvest.faces)) {
      faces[family] = SIZES.filter((size) => reader.faces[family]?.[size] && mermaidBoxesAgree(sizes[size], reader.faces[family][size]));
    }
    classes[name] = { measured: { reader: reader.who, harvest: harvest.who }, faces };
  }
  writeFileSync(OUTPUT, JSON.stringify({ generated: 'scripts/mermaid-reader-match.mjs — do not edit', probe: probeHash, classes }, null, 1) + '\n');
  console.log(`wrote ${path.relative(root, OUTPUT)}`);
  for (const [name, { faces }] of Object.entries(classes)) for (const [family, sizes] of Object.entries(faces)) console.log(`${name} ${family}: ${sizes.join(', ') || 'none'}`);
}

if (command === 'measure') await measure(args[0], args[1], args.includes('--harvest'));
else if (command === 'table') await table(args[0], args.slice(1));
else { console.error('usage: mermaid-reader-match.mjs measure <base> <out.json> [--harvest] | table <harvest.json> <class>=<reader.json>...'); process.exit(2); }
