/**
 * Internal: what publish settles about a page before sending it: an empty page is refused,
 * placeholders left from the starter it was copied from are named by line, and `--artifact ID`
 * without a usable companion takes that page's current head as its baseline.
 * Used by: toolbox-publish.mjs, author-toolbox tests.
 */
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {ToolError,serverOrigin} from './toolbox-client.mjs';
import {pairRecovery} from './toolbox-source.mjs';

/** True when the page shows nothing: no element or text outside <head>, and no script. */
export function emptyPage(source) {
  const rest = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<head\b[\s\S]*?<\/head\s*>/i, '')
    .replace(/<(title|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  const shell = ['html', 'head', 'body', 'meta', 'link', 'base'];
  const tags = [...rest.matchAll(/<([a-z][a-z0-9-]*)/gi)].map(match => match[1].toLowerCase());
  return !tags.some(tag => !shell.includes(tag)) && !rest.replace(/<[^>]*>/g, '').trim();
}

export function refuseEmpty(source, file) {
  const name = path.basename(file);
  if (emptyPage(source)) throw new ToolError('empty_page', `${name} has no page content: its ` +
    'body is empty and it has no script.', 2,
    `Write the page into ${name} (with your file-writing tool), then publish it.`);
}

let starters;
/** Each shipped starter (examples/*.html): its header line ("Example: …", which starters say to
 * keep) and its bracketed placeholder texts, e.g. "[Company]". */
export function starterIndex(directory) {
  if (!directory && starters) return starters;
  const found = [], from = directory ?? new URL('../examples/', import.meta.url);
  try {
    for (const name of readdirSync(from).filter(name => name.endsWith('.html'))) {
      const html = readFileSync(new URL(name, from), 'utf8'), texts = new Set();
      for (const [text, inner] of html
        .matchAll(/(?<![\w)\].$])\[([^[\]\n'"`=(){};<>]{2,120})\]/g))
        if (/[A-Za-z]{2}/.test(inner) && (/^[A-Z][^.]*$/.test(inner) || /[\s@]/.test(inner)))
          texts.add(text);
      found.push({header: /<!--\s*(Example:[^\n.]*)/.exec(html)?.[1] ?? null, texts});
    }
  } catch {}
  if (!directory) starters = found;
  return found;
}
/** Every starter's bracketed placeholder texts. */
export const starterTexts = directory =>
  new Set(starterIndex(directory).flatMap(starter => [...starter.texts]));
/** The placeholders to look for in a page: all of the starter whose header line it still carries;
 * otherwise only multi-word ones ("[Market size in one sentence]"), never a page's "[Draft]". */
export function pagePlaceholders(source, index = starterIndex()) {
  const copied = index.filter(starter => starter.header && source.includes(starter.header));
  return new Set(copied.length ? copied.flatMap(starter => [...starter.texts]) :
    index.flatMap(starter => [...starter.texts].filter(text => /\s/.test(text))));
}

const at = (source, offset) => {
  const before = source.slice(0, offset);
  return {line: before.split('\n').length, column: offset - before.lastIndexOf('\n')};
};
/** Starter placeholders still in the page, as autofix problems: a ref: link with no real ID, and
 * bracketed text from the starter it was copied from. */
export function placeholderProblems(source, texts = pagePlaceholders(source)) {
  const problems = [];
  // A ref: in a tag the page renders; one in a comment (a starter's own usage line) is not a link.
  const code = source.replace(/<!--[\s\S]*?-->|^[ \t]*\/\/.*$/gm, m => ' '.repeat(m.length));
  for (const match of code.matchAll(/\b(?:href|src)\s*=\s*["']ref:([^"']*)["']/gi))
    if (!/^[A-Za-z0-9]{6,12}$/.test(match[1]))
      problems.push({rule: 'starter-placeholder', ...at(source, match.index), snippet: match[0],
        message: `ref:${match[1]} is a starter placeholder: publish that data first ` +
          '(node scripts/publish.mjs FILE.csv) and put the ID it prints after ref:'});
  for (const text of texts) {
    const offset = source.indexOf(text);
    if (offset >= 0) problems.push({rule: 'starter-placeholder', ...at(source, offset),
      snippet: text, message: `starter placeholder ${text} is still in the page: replace it ` +
        'with the real text'});
  }
  return problems;
}

/** The baseline of `--artifact ID` without a usable companion: the page's current head. */
export async function headBaseline(client, id, type) {
  const head = await client.request(`/api/artifacts/${id}`);
  const format = head.format === 'html' ? 'html' : head.format === 'dataset' ? 'dataset' : 'asset';
  if (format !== type) throw new ToolError('type_mismatch', `Page ${id} holds ${head.format ??
    'another format'}, not ${type}.`, 2, 'Publish a file of the same kind over it.');
  return {kind: 'head', id, version: head.version, state: head.state, dependencyReceipts: [],
    retainedBackends: [], ...(Number.isSafeInteger(head.sharing_revision) ?
      {sharingRevision: head.sharing_revision} : {})};
}

/** A data or media file's companion (FILE.af.json), checked against the file it sits beside. */
export function dataBaseline(sidecar, file, server) {
  let saved = null;
  try { saved = JSON.parse(sidecar); } catch {}
  const name = path.basename(file), ok = saved?.kind === 'data-baseline' && saved.schema === 1 &&
    /^[A-Za-z0-9]{6,12}$/.test(saved.id ?? '') && Number.isSafeInteger(saved.version) &&
    saved.version >= 1 && /^[a-f0-9]{64}$/.test(saved.state ?? '');
  const cause = !ok ? `${name}.af.json is not a readable companion` :
    saved.server !== serverOrigin(server) ? `${name}.af.json belongs to another server` :
    saved.sourceFile !== name ?
      `${name}.af.json belongs to ${saved.sourceFile} (renamed or copied)` :
    saved.historical ? `${name} was read from saved version ${saved.version}` : null;
  if (cause) throw new ToolError('invalid_baseline', cause + ', so publish cannot tell what it ' +
    'replaces.', 2, pairRecovery(name, ok ? saved.id : 'ID'));
  return saved;
}
