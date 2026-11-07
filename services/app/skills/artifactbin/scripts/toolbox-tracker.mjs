/**
 * Internal: the tracker generator. Picks the features (a preset minus --without, refusing unknown
 *   names and missing requirements) and trims examples/tracker*.* to them: marker lines
 *   `<!-- @feature X -->`, `/* @feature X *\/` or `// @feature X` open a block that `@end X`
 *   closes, and a line ending in such a comment `@only X` is one line of X. `!X` is kept only
 *   when X is dropped. Kept markers stay, so a reader can still drop a feature by hand; `!X`
 *   markers go.
 * Used by: new-app.mjs, the tracker combinations test.
 */
import {readFile} from 'node:fs/promises';
import {FEATURES, PRESETS} from '../examples/tracker-features.mjs';
import {ToolError} from './toolbox-client.mjs';

const OPEN = /^\s*(?:<!--|\/\*|\/\/)\s*@feature\s+(!?[\w-]+)/;
const CLOSE = /^\s*(?:<!--|\/\*|\/\/)\s*@end\s+(!?[\w-]+)/;
const ONLY = /\s*(?:<!--|\/\*|\/\/)\s*@only\s+(!?[\w-]+)\s*(?:\*\/|-->)?\s*$/;
const EXAMPLES = new URL('../examples/', import.meta.url);
/** Template file → its name in the project. */
export const TRACKER_FILES = [['tracker.html', 'index.html'], ['tracker.ts', 'tracker.ts'],
  ['tracker-steps.mjs', 'steps.mjs'], ['tracker-guest.mjs', 'guest.mjs'],
  ['tracker-cleanup.mjs', 'cleanup.mjs']];

/** The feature names a source marks; throws on an unbalanced or unknown marker. */
export function markers(source, file = 'source') {
  const names = new Set(), stack = [];
  source.split('\n').forEach((line, i) => {
    const open = OPEN.exec(line), close = CLOSE.exec(line), only = ONLY.exec(line);
    if (open) { stack.push(open[1]); names.add(open[1].replace(/^!/, '')); }
    else if (only) names.add(only[1].replace(/^!/, ''));
    else if (close) {
      const top = stack.pop();
      if (top !== close[1])
        throw Error(`${file} line ${i + 1}: @end ${close[1]} closes ${top ?? 'nothing'}`);
    }
  });
  if (stack.length) throw Error(`${file}: unclosed @feature ${stack.join(', ')}`);
  for (const name of names) if (!FEATURES[name]) throw Error(`${file}: unknown feature ${name}`);
  return names;
}
/** SOURCE with only the kept features' blocks. */
export function trim(source, keep, file) {
  markers(source, file);
  const out = [], stack = [], live = () => stack.every(s => s.keep);
  const holds = name => name.startsWith('!') ? !keep.has(name.slice(1)) : keep.has(name);
  for (const line of source.split('\n')) {
    const open = OPEN.exec(line), close = CLOSE.exec(line), only = ONLY.exec(line);
    if (only && !open && !close) {
      if (live() && holds(only[1]))
        out.push(only[1].startsWith('!') ? line.replace(ONLY, '') : line);
    } else if (open) {
      const neg = open[1].startsWith('!'), on = keep.has(open[1].replace(/^!/, ''));
      stack.push({keep: neg ? !on : on, neg});
      if (live() && !neg) out.push(line);
    } else if (close) {
      const top = stack.at(-1), wasLive = live();
      stack.pop();
      if (wasLive && !top.neg) out.push(line);
    } else if (live()) out.push(line);
  }
  return out.join('\n');
}
const invalid = (code, message, recovery) => new ToolError(code, message, 2, recovery);
/** The kept features: PRESET's minus WITHOUT; refuses unknown names and missing requirements.
 * @param {{preset?: string, without?: string[]}} [choice]
 * @returns {Set<string>} */
export function trackerFeatures({preset = 'tasks', without = []} = {}) {
  if (!Object.hasOwn(PRESETS, preset)) throw invalid('invalid_preset',
    `--preset ${preset} is not a tracker preset.`, 'Use --preset tasks or --preset list.');
  const names = Object.keys(FEATURES).join(', ');
  for (const name of without) if (!Object.hasOwn(FEATURES, name)) throw invalid('unknown_feature',
    `${name} is not a tracker feature.`, `Name features from: ${names}.`);
  const keep = new Set(PRESETS[preset].features.filter(name => !without.includes(name)));
  for (const name of keep) for (const need of FEATURES[name].requires) if (!keep.has(need))
    throw invalid('feature_requires', `${name} needs ${need}.`,
      `Drop ${name} too (--without ${[...without, name].join(',')}), or keep ${need}.`);
  return keep;
}
/** The project's files for KEEP: name → text, trimmed, with the preset's texts and the limit.
 * @param {Set<string>} keep @param {{preset?: string, limit?: number}} [options]
 * @param {URL} [from] @returns {Promise<Record<string, string>>} */
export async function trackerFiles(keep, {preset = 'tasks', limit} = {}, from = EXAMPLES) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const [source, name] of TRACKER_FILES) {
    const owner = Object.entries(FEATURES).find(([, f]) => f.files?.includes(source));
    if (owner && !keep.has(owner[0])) continue;
    let text = trim(await readFile(new URL(source, from), 'utf8'), keep, source);
    if (name === 'index.html') for (const [from, to] of Object.entries(PRESETS[preset].texts))
      text = text.replaceAll(`'${from}'`, `'${to}'`);
    if (limit !== undefined) text = text.replace(/^(\s*limit: )\d+,/m, `$1${limit},`)
      .replace(/^const LIMIT=\d+;/m, `const LIMIT=${limit};`);
    files[name] = text;
  }
  return files;
}
