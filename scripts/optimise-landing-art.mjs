#!/usr/bin/env node
/**
 * THE LANDING ILLUSTRATIONS, MADE FIT TO SERVE.
 *
 * The source art is 1254px PNG at ~2.8 MB each — twelve of them is 34 MB, for
 * pictures the page never draws wider than ~360 CSS px. This writes the two
 * WebP renderings the page actually references (1x and 2x) beside the sources,
 * and the sources themselves need never be deployed.
 *
 * Same stance as lib/images/optimise.ts, which does this for UPLOADS: cap the
 * edge, convert to WebP, and never return something worse than what was given.
 * The difference is only WHEN — these are repo assets, so the conversion is a
 * committed artefact rather than a publish-time step, and it runs by hand:
 *
 *     node scripts/optimise-landing-art.mjs
 *
 * Idempotent — re-running overwrites with identical bytes, so adding one
 * illustration means dropping the PNG in and running it again.
 */
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Where the art lives, and the widths the page asks for (1x, 2x). */
const DIR = new URL('../services/app/public/landing/', import.meta.url).pathname;
export const ART_WIDTHS = [380, 760];
/** Chosen by measuring: q80 held the felt grain that q70 smeared flat. */
const QUALITY = 80;

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.png'))
  .sort();

let before = 0;
let after = 0;
for (const file of sources) {
  const base = file.replace(/\.png$/, '');
  before += statSync(join(DIR, file)).size;
  for (const width of ART_WIDTHS) {
    const out = join(DIR, `${base}-${width}.webp`);
    const { size } = await sharp(join(DIR, file))
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(out);
    after += size;
    process.stdout.write(`${base}-${width}.webp `.padEnd(36) + kb(size) + '\n');
  }
}
console.log(`\n${sources.length} sources ${kb(before)} → ${kb(after)} in WebP`);
