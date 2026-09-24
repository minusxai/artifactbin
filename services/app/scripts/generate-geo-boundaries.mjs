#!/usr/bin/env node
/**
 * Generates the bundled boundary sets `<DeckGL>` draws with `"data":"boundary:<id>"`
 * (lib/viz/geo-assets). Output is committed; rerun only to change a source or a
 * simplification level, and review the diff:
 *
 *   node scripts/generate-geo-boundaries.mjs
 *
 * Source, pinned: Natural Earth v5.1.2 admin-0 countries at 1:110m (public
 * domain), as `countries` with `name`, `iso_a2` and `iso_a3` to join on. It also
 * stamps `india-states` (India's official boundaries) with ISO 3166-2 `code`s.
 * Any other geography is the author's own GeoJSON dataset, not a bundled set.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { topology } from 'topojson-server';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public/geojson');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson';
const CACHE = join(tmpdir(), 'artifactbin-natural-earth-v5.1.2');
const QUANTIZE = 1e4;

async function source(name) {
  const file = join(CACHE, `${name}.geojson`);
  if (!existsSync(file)) {
    await mkdir(CACHE, { recursive: true });
    const resp = await fetch(`${NE}/${name}.geojson`);
    if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
    await writeFile(file, Buffer.from(await resp.arrayBuffer()));
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Natural Earth writes -99 where ISO has no code; its _EH columns carry the de facto one. */
const iso = (p, key) => (p[key] && p[key] !== '-99' ? p[key] : p[`${key}_EH`] && p[`${key}_EH`] !== '-99' ? p[`${key}_EH`] : null);

/** A FeatureCollection as quantized TopoJSON under `object`. */
const compact = (object, features) => JSON.stringify(topology({ [object]: { type: 'FeatureCollection', features } }, QUANTIZE));

const countryFeature = f => ({
  type: 'Feature',
  properties: { name: f.properties.NAME, iso_a2: iso(f.properties, 'ISO_A2'), iso_a3: iso(f.properties, 'ISO_A3') },
  geometry: f.geometry,
});

// ISO 3166-2:IN, current codes, keyed by the names india-states.json uses.
const INDIA_CODES = {
  'Andaman and Nicobar Islands': 'IN-AN', 'Andhra Pradesh': 'IN-AP', 'Arunachal Pradesh': 'IN-AR', 'Assam': 'IN-AS',
  'Bihar': 'IN-BR', 'Chandigarh': 'IN-CH', 'Chhattisgarh': 'IN-CG', 'Dadra and Nagar Haveli and Daman and Diu': 'IN-DH',
  'Delhi': 'IN-DL', 'Goa': 'IN-GA', 'Gujarat': 'IN-GJ', 'Haryana': 'IN-HR', 'Himachal Pradesh': 'IN-HP',
  'Jammu and Kashmir': 'IN-JK', 'Jharkhand': 'IN-JH', 'Karnataka': 'IN-KA', 'Kerala': 'IN-KL', 'Ladakh': 'IN-LA',
  'Lakshadweep': 'IN-LD', 'Madhya Pradesh': 'IN-MP', 'Maharashtra': 'IN-MH', 'Manipur': 'IN-MN', 'Meghalaya': 'IN-ML',
  'Mizoram': 'IN-MZ', 'Nagaland': 'IN-NL', 'Odisha': 'IN-OD', 'Puducherry': 'IN-PY', 'Punjab': 'IN-PB',
  'Rajasthan': 'IN-RJ', 'Sikkim': 'IN-SK', 'Tamil Nadu': 'IN-TN', 'Telangana': 'IN-TS', 'Tripura': 'IN-TR',
  'Uttar Pradesh': 'IN-UP', 'Uttarakhand': 'IN-UK', 'West Bengal': 'IN-WB',
};

async function main() {
  const countries = await source('ne_110m_admin_0_countries');
  await writeFile(join(OUT, 'countries.json'), compact('countries', countries.features.map(countryFeature)));

  // India's official state boundaries, stamped with ISO 3166-2 codes.
  const indiaFile = join(OUT, 'india-states.json');
  const india = JSON.parse(await readFile(indiaFile, 'utf8'));
  for (const f of india.features) {
    const code = INDIA_CODES[f.properties.name];
    if (!code) throw new Error(`india-states: no ISO code for "${f.properties.name}"`);
    f.properties = { name: f.properties.name, code, postal: code.slice(3) };
  }
  await writeFile(indiaFile, JSON.stringify(india));
  console.log(`boundaries: countries (${countries.features.length}), india-states codes`);
}

await main();
