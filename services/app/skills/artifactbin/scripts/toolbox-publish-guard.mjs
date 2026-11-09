/**
 * Internal: what publish settles about a file before sending it: what it replaces (its marker's
 * version, checked against the page's head, or with `--artifact ID` that head), a file with no
 * marker or an exported page refused, an empty page refused, placeholders left from the starter it
 * was copied from named by line; and the update command a data or media file is told.
 * Used by: toolbox-publish.mjs, read.mjs, author-toolbox tests.
 */
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {ToolError,platform} from './toolbox-client.mjs';

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
        message: `ref:${match[1]} is a starter placeholder: link the data file by its path ` +
          '(href="./FILE.csv") or put a real ID after ref:'});
  for (const text of texts) {
    const offset = source.indexOf(text);
    if (offset >= 0) problems.push({rule: 'starter-placeholder', ...at(source, offset),
      snippet: text, message: `starter placeholder ${text} is still in the page: replace it ` +
        'with the real text'});
  }
  return problems;
}

const receiptsOf = head => Array.isArray(head.dependencyReceipts) ? head.dependencyReceipts : [];
/** @typedef {import('../../../lib/skills/author-toolbox-contract').AuthorBaseline} Baseline */
/** The baseline of `--artifact ID` over a file without its marker: the page's current head, with
 * the dependency receipts the page recorded (a rebuild updates its datasets, never duplicates).
 * @returns {Promise<Baseline>} */
export async function headBaseline(client, id, type) {
  const head = await client.request(`/api/artifacts/${id}`);
  const format = head.format === 'html' ? 'html' : head.format === 'dataset' ? 'dataset' : 'asset';
  if (format !== type) throw new ToolError('type_mismatch', `Page ${id} holds ${head.format ??
    'another format'}, not ${type}.`, 2, 'Publish a file of the same kind over it.');
  return {id, version: head.version, state: head.state, dependencyReceipts: receiptsOf(head),
    retainedBackends: [], ...(Number.isSafeInteger(head.sharing_revision) ?
      {sharingRevision: head.sharing_revision} : {}),
    ...(head.filename ? {filename: head.filename} : {}),
    ...(head.contentType ? {contentType: head.contentType} : {})};
}

/** The baseline a marker names: its version, which must still be the page's head (a newer one is
 * never overwritten), with the receipts the page recorded and the backends the source links. */
export async function markedBaseline(client, marker, name, source) {
  const head = await client.request(`/api/artifacts/${marker.id}`);
  if (head.version !== marker.version) throw new ToolError('version_conflict',
    `Page ${marker.id} changed since ${name} was saved (version ${marker.version} there, ` +
    `${head.version} now).`, 4, `Run node scripts/read.mjs ${marker.id} --output ${name} (an ` +
    'edited file is kept and the read goes beside it), reapply your edits there and publish ' +
    'that file.');
  return {id: marker.id, version: marker.version, state: marker.state,
    dependencyReceipts: receiptsOf(head), retainedBackends: (await platform())
      .previewBackendLinks(source), ...(Number.isSafeInteger(marker.sharingRevision) ?
      {sharingRevision: marker.sharingRevision} : {})};
}

/** An HTML file with no marker is refused: it may be a page rewritten whole, never assumed new. */
export function unmarked(source, name) {
  if (/data-af\s*=\s*["'](?:portable|runtime|offline-source)/i.test(source))
    throw new ToolError('exported_source', 'This HTML is an exported page, not authoring source.',
      2, 'Publish it as a new page with --create, or over a page with --artifact ID.');
  throw new ToolError('unmarked_source', `${name} has no af-authoring marker, so publish cannot ` +
    'tell which page it is.', 2, 'If it is a page you published before (rewritten whole, so its ' +
    `marker is gone): node scripts/publish.mjs ${name} --artifact ID. Only for a new page: ` +
    `node scripts/publish.mjs ${name} --create.`);
}

/** What a published data or media file is told: the one command that updates it. */
export const updateNext = (name, id, type) => {
  const kind = type === 'dataset' ? 'dataset' : 'file';
  return `Next: to publish an edit of ${name} over ${kind} ${id}: node scripts/publish.mjs ` +
    `${name} --artifact ${id} (without --artifact a new ${kind} is created).`;
};

/** A CSV with a header and no rows is an empty table: its columns are declared, as text. */
export function emptyTable(extension,source){
 const lines=extension==='.csv'?String(source).split(/\r?\n/).filter(line=>line.trim()):[];
 if(lines.length!==1)return {};
 const names=[...lines[0].matchAll(/(?:^|,)\s*(?:"((?:[^"]|"")*)"|([^,]*))/g)]
  .map(m=>(m[1]??m[2]??'').replace(/""/g,'"').trim()).filter(Boolean);
 return names.length?{columns:names.map(name=>({name,type:'string'}))}:{};
}
