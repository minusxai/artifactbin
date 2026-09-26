/**
 * Regenerates the offline-file gate's checked-in fixture
 * (scripts/fixtures/offline-file/artifact-file.json) from its markup
 * (dashboard.jsx), through the SAME parse, prepare and CSS compile the app
 * serves a document with — so the fixture's nodes, dataflow and stylesheet
 * cannot drift from what a real download would carry. The query results are
 * written here by hand: the fixture has no dataset, and the point of the gate
 * is the file, not the engine.
 *
 *   cd services/app && npx tsx scripts/generate-offline-fixture.ts
 *
 * Needs the SSR bundle (npm run build:runtime) and public/fonts (postinstall).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { stampNodeIds } from '@/lib/story/node-ids';
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';
import type { Dataflow, DataflowState, TableResult } from '@/lib/story/dataflow';
import { ARTIFACT_FILE_FORMAT, parseArtifactFile, sourceDigest, type ArtifactFile } from '@/lib/offline/file-format';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.resolve(APP, '../../scripts/fixtures/offline-file');
/*
 * Stamped the way publish stamps every stored document (lib/artifacts), so the
 * fixture's elements carry the node ids comments anchor to and edits keep.
 */
const source = stampNodeIds(readFileSync(path.join(FIXTURE, 'dashboard.jsx'), 'utf8').trim(), { retireLegacyAliases: true }).source;

const parsed = parseJsx(source);
if (!parsed.ok) throw new Error('dashboard.jsx does not parse');
const { content } = splitHelmet(parsed.nodes);
const flow: Dataflow = { values: content.values, queries: content.queries, ...(content.mutations.length ? { mutations: content.mutations } : {}) };

const salesRows = [
  { region: 'east', month: '2026-07', revenue: 120 }, { region: 'east', month: '2026-08', revenue: 180 },
  { region: 'north', month: '2026-07', revenue: 40 }, { region: 'north', month: '2026-08', revenue: 65 },
  { region: 'west', month: '2026-07', revenue: 210 }, { region: 'west', month: '2026-08', revenue: 260 },
];
const sales = (rows: typeof salesRows): TableResult => ({
  rows, columns: [{ name: 'region', type: 'string' }, { name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }],
});
const state: DataflowState = {
  values: { region: null, note: null },
  tables: {
    regions: { rows: [{ region: 'east' }, { region: 'north' }, { region: 'west' }], columns: [{ name: 'region', type: 'string' }] },
    sales: sales(salesRows),
    matches: { rows: [{ n: 6 }], columns: [{ name: 'n', type: 'number' }] },
  },
  errors: {},
};

const compiledCss = await compileStoryCss(source, { force: true });
const { runtime } = await prepareStoryParts({
  source, compiledCss, theme: null, colorMode: null, template: 'dashboard', refData: {}, title: 'Regional sales',
  dataflow: { flow, state },
});

/*
 * The download inlines every font as a data: URI. The fixture keeps it small:
 * the body face (Inter, latin) is inlined and every other face is dropped, so
 * the file references nothing outside itself either way.
 */
const KEEP_FONT = 'inter-latin-standard-normal';
const base = runtime.baseCss
  .replace(/@font-face\s*{[^}]*}/g, (face) => {
    const url = face.match(/url\("?(\/fonts\/[^")]+)"?\)/)?.[1];
    if (!url) return face;
    if (!url.includes(KEEP_FONT)) return '';
    const data = readFileSync(path.join(APP, 'public', url)).toString('base64');
    return face.replace(/url\("?\/fonts\/[^")]+"?\)/, `url("data:font/woff2;base64,${data}")`);
  });
const css = { base, compiled: runtime.compiledCss ?? null, author: runtime.authorCss ?? null };
if (/url\("?\//.test([css.base, css.compiled, css.author].join('\n'))) throw new Error('fixture css still references a server path');

const at = '2026-09-26T10:00:00.000Z';
const file: ArtifactFile = {
  format: ARTIFACT_FILE_FORMAT,
  origin: 'https://app.artifactbin.dev',
  artifactId: 'Of1ine',
  liveUrl: 'https://app.artifactbin.dev/a/Of1ine',
  downloadedBy: 'Gate',
  downloadedAt: at,
  base: { version: 1, editId: 'e1', source },
  source,
  metadata: { title: runtime.title, description: null, theme: null, template: 'dashboard', colorMode: null },
  css,
  island: { ...runtime.data, dataflow: { flow, state } },
  snapshot: {
    at,
    state,
    variants: ['east', 'north', 'west'].map((region) => ({
      values: { region },
      tables: { sales: sales(salesRows.filter((r) => r.region === region)) },
      errors: {},
    })),
    // Free text has no finite domain: its control is disabled offline.
    frozen: ['note'],
  },
  journal: [],
  threads: [],
  localIds: [],
  bundle: 'core',
  // No `extras`: their hash changes with every build, so the gate adds the current one when it renders the file.
  derivedFrom: sourceDigest(source),
};
parseArtifactFile(JSON.parse(JSON.stringify(file)));
writeFileSync(path.join(FIXTURE, 'artifact-file.json'), JSON.stringify(file, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), path.join(FIXTURE, 'artifact-file.json'))} (${JSON.stringify(css).length} bytes of css)`);
