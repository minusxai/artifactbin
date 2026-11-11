/**
 * Internal: what new-app.mjs's starters share (files copied without overwriting, a dataset
 * published once and reused through the ref: the kept page links it by, the page's placeholders
 * filled, the publish step). The tracker's trimming is toolbox-tracker.mjs.
 * Used by: new-app.mjs.
 */
import path from 'node:path';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {optionalFile} from './toolbox-client.mjs';
import {publishCommand} from './toolbox-publish.mjs';
import {publishStep} from './toolbox-source.mjs';

export const EXAMPLES = new URL('../examples/', import.meta.url);
/** Publish (a first publish creates the page), then check with the starter's steps files. */
export const check = async page => `${await publishStep(page, 'index.html')} && node ` +
  'scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps ' +
  'cleanup.mjs';
export const resolve = (base, file) => path.resolve(base, String(file)
  .replace(/^~(?=$|[\\/])/, homedir()));
const htmlText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Writes FILE only when nothing is there yet; false when it was kept. */
export async function create(file, bytes) {
  try { await writeFile(file, bytes, {flag: 'wx'}); return true; } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
/** The dataset the page links as `extra.name` (its ref:, kept from an earlier run), or a new one
 * published from FILE (extra: publish flags). People write its rows, so it is linked by id, never
 * by path: a page publish must not replace them. */
export async function dataset(page, file, title, server, options, extra) {
  const html = String(await optionalFile(page) ?? '');
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const id = /\shref\s*=\s*["']ref:([A-Za-z0-9]{6,12})["']/i.exec(tag)?.[1];
    if (id && new RegExp(`\\sdata-af-name\\s*=\\s*["']${extra.name}["']`, 'i').test(tag))
      return {id, reused: true};
  }
  const done = await publishCommand({values: {server, title, ...extra}, positionals: [file]},
    options);
  return {id: done.id, reused: false};
}
/** index.html with the starter's placeholders that are still there replaced. */
export function fill(html, starter, {title, ids}) {
  const placeholder = /<title>(\[[^\]<]+\])<\/title>/.exec(starter)?.[1];
  const out = html.replaceAll('ref:DATASET_ID', 'ref:' + ids.own);
  return placeholder ? out.replaceAll(`<title>${placeholder}</title>`,
    `<title>${htmlText(title)}</title>`) : out;
}
