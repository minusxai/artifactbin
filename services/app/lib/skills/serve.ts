/**
 * `/docs` over HTTP — ONE handler for the whole tree, and every answer names
 * the way on:
 *
 * - `GET /docs` (and `/llms.txt`): the listing — one line per file, full URL
 *   and `description`, grouped by skill, `SKILL.md` first (the `name` is the
 *   plugin's business and lives in the file's frontmatter). ≤ 6 KB, so it
 *   costs nothing to fetch twice; it is what an agent reads to CHOOSE.
 * - `GET /docs/<skill>`: that skill's files, same line shape.
 * - `GET /docs/<skill>/<file>.md`: the rendered file (as `text/plain` — the
 *   readers agents use reject `text/markdown`).
 * - `GET /docs?download=true`: the rendered tree as a `.tar.gz` (the plugin's
 *   `skills/` folder, one code path).
 * - a browser (`Accept: text/html`) asking for `/docs` or a skill gets the
 *   tour for people (`/docs/human`); a file is served as-is.
 * - anything else: 404 JSON naming the nearest directory's children — the
 *   same "name the fix" reflex every other refusal has.
 *
 * Pure over a tree + base; the route hands it the request.
 */
import { MARKDOWN_CONTENT_TYPE } from '@/lib/http';
import { tarGz } from './tar';
import { renderSkill, type DocTransport, type SkillDelivery } from './render';
import { ROOT_SKILL, SKILL_FILE_NAME, type SkillDir, type SkillFile, type SkillTree } from './tree';

const transportQuery = (transport: DocTransport) => transport === 'mcp' ? '?transport=mcp' : '';

const DOCS_LISTING_HEADER = (base: string, tree: SkillTree, transport: DocTransport = 'curl') =>
  `# artifactbin docs — one skill: the brief + ${tree.files.filter((f) => f.audience === 'agent' && f.ref).length} reference files; every file keeps its critical content at the TOP.
# Read ${base}/docs/${ROOT_SKILL}/${SKILL_FILE_NAME}${transportQuery(transport)} first; its dispatch table says which reference to open. Lines: URL, when to read.
# The tree as a folder: curl -s "${base}/docs?download=true${transport === 'mcp' ? '&transport=mcp' : ''}" | tar xz   (then grep -rl <term> skills/)`;

const line = (base: string, f: SkillFile, transport: DocTransport) => `${base}/docs/${f.path}${transportQuery(transport)}\t${f.description}`;

export function docsListing(tree: SkillTree, base: string, dir?: SkillDir, transport: DocTransport = 'curl'): string {
  const dirs = dir ? [dir] : tree.dirs;
  const body = dirs
    .map((d) => `## ${d.name}\n${d.files.filter((f) => f.audience === 'agent').map((f) => line(base, f, transport)).join('\n')}`)
    .join('\n\n');
  const head = dir ? `# artifactbin docs — the ${dir.name} skill. Read its ${SKILL_FILE_NAME} first; the whole tree is at ${base}/docs${transportQuery(transport)}.` : DOCS_LISTING_HEADER(base, tree, transport);
  return `${head}\n\n${body}\n`;
}

/** Every agent-facing file rendered — the plugin's `skills/` and the archive come from this one call. */
export function renderTree(tree: SkillTree, base: string, transport: DocTransport = 'curl', delivery?: SkillDelivery): Array<{ file: SkillFile; text: string }> {
  return tree.files.filter((f) => f.audience === 'agent').map((file) => ({ file, text: renderSkill(file, { base, transport, delivery }) }));
}

/** A rendered file with its frontmatter — the shape a plugin loader reads `name`/`description` from. */
export function skillFileWithFrontmatter(file: SkillFile, text: string): string {
  const fm = [`name: ${file.file === SKILL_FILE_NAME ? file.name : JSON.stringify(file.name)}`, `description: ${JSON.stringify(file.description)}`].join('\n');
  return `---\n${fm}\n---\n${text}`;
}

function docsArchive(tree: SkillTree, base: string, transport: DocTransport = 'curl'): Buffer {
  return tarGz(renderTree(tree, base, transport, 'http').map(({ file, text }) => ({ path: `skills/${file.path}`, content: skillFileWithFrontmatter(file, text) })));
}

// text/plain, not text/markdown: the readers agents use (ChatGPT browsing,
// r.jina.ai) reject or download the markdown type — see lib/http.
const MARKDOWN = MARKDOWN_CONTENT_TYPE;
const noStore = (type: string) => ({ 'Content-Type': type, 'Cache-Control': 'no-store' });

export interface ServeDocsInput {
  tree: SkillTree;
  base: string;
  /** The path under `/docs`, `''` for the root. */
  path: string;
  accept: string;
  download: boolean;
  /** Which action vocabulary this HTTP-delivered skill teaches. */
  transport?: DocTransport;
}

export function serveDocs({ tree, base, path, accept, download, transport = 'curl' }: ServeDocsInput): Response {
  const wantsHtml = accept.includes('text/html');
  const segments = path.split('/').filter(Boolean);
  if (download && segments.length === 0) {
    return new Response(new Uint8Array(docsArchive(tree, base, transport)), {
      status: 200,
      headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="artifactbin-docs.tar.gz"', 'Cache-Control': 'no-store' },
    });
  }
  if (segments.length === 0) {
    if (wantsHtml) return Response.redirect(`${base}/docs/human`, 307);
    return new Response(docsListing(tree, base, undefined, transport), { status: 200, headers: noStore(MARKDOWN) });
  }
  if (segments.length === 1) {
    const dir = tree.dir(segments[0]);
    if (dir) {
      if (wantsHtml) return Response.redirect(`${base}/docs/human`, 307);
      return new Response(docsListing(tree, base, dir, transport), { status: 200, headers: noStore(MARKDOWN) });
    }
    return notFound(tree, base, undefined, path);
  }
  const file = tree.get(segments.join('/'));
  if (file && file.audience === 'agent') return new Response(renderSkill(file, { base, transport, delivery: 'http' }), { status: 200, headers: noStore(MARKDOWN) });
  // `/docs/<skill>/references` — the folder itself: answer the skill's listing
  // rather than a 404, since the address is one an agent plausibly guesses.
  if (segments.length === 2 && segments[1] === 'references') {
    const dir = tree.dir(segments[0]);
    if (dir) {
      if (wantsHtml) return Response.redirect(`${base}/docs/human`, 307);
      return new Response(docsListing(tree, base, dir, transport), { status: 200, headers: noStore(MARKDOWN) });
    }
  }
  return notFound(tree, base, tree.dir(segments[0]), path);
}

function notFound(tree: SkillTree, base: string, dir: SkillDir | undefined, path: string): Response {
  const children = (dir ? dir.files : tree.dirs.map((d) => d.skill)).filter((f) => f.audience === 'agent').map((f) => `${base}/docs/${f.path}`);
  const body = {
    error: 'not_found',
    hint: dir
      ? `no file "${path}" — the ${dir.name} skill has these; its ${SKILL_FILE_NAME} says when to read each`
      : `no docs at "${path}" — the tree is listed at ${base}/docs, one skill per directory, each with a ${SKILL_FILE_NAME}`,
    children,
  };
  return new Response(`${JSON.stringify(body, null, 2)}\n`, { status: 404, headers: noStore('application/json; charset=utf-8') });
}
