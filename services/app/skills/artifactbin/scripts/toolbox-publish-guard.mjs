/**
 * Internal: what publish settles about a page before sending it: an empty page is refused, starter
 * placeholders left in it are named by line, and `--artifact ID` without a usable companion takes
 * that page's current head as its baseline.
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
/** The bracketed placeholder texts of the shipped starters (examples/*.html), e.g. "[Company]". */
export function starterTexts(directory) {
  if (!directory && starters) return starters;
  const found = new Set(), from = directory ?? new URL('../examples/', import.meta.url);
  try {
    for (const name of readdirSync(from).filter(name => name.endsWith('.html')))
      for (const [text, inner] of readFileSync(new URL(name, from), 'utf8')
        .matchAll(/\[([^[\]\n'"`=(){};<>]{2,120})\]/g))
        if (/[A-Za-z]{2}/.test(inner) && (/^[A-Z][^.]*$/.test(inner) || /[\s@]/.test(inner)))
          found.add(text);
  } catch {}
  if (!directory) starters = found;
  return found;
}

const at = (source, offset) => {
  const before = source.slice(0, offset);
  return {line: before.split('\n').length, column: offset - before.lastIndexOf('\n')};
};
/** Starter placeholders still in the page, as autofix problems: a ref: link with no real ID, and
 * any starter's bracketed text. */
export function placeholderProblems(source, texts = starterTexts()) {
  const problems = [];
  for (const match of source.matchAll(/\b(?:href|src)\s*=\s*["']ref:([^"']*)["']/gi))
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
