/**
 * THE DOCS ARE ONE SKILL — `skills/artifact-bin/SKILL.md` (the brief, with a
 * dispatch table) over `skills/artifact-bin/references/*.md` (the topic
 * files, flat), laid out exactly as Claude's Agent Skills convention has it,
 * so the repo folder IS the plugin folder and `/docs` is a listing of it.
 * One preloaded name + description triggers the whole surface; every topic
 * file is loaded on demand by the dispatch table or the listing.
 *
 * This module is PURE over an in-memory file map (path → text): the fs walk
 * is the one impure function at the bottom, so every rule below is tested
 * against a literal tree with no disk. The rules:
 *
 * - a top-level directory is a skill and must hold a `SKILL.md`; its detail
 *   files live flat under `references/` — nothing else, nothing deeper;
 * - frontmatter: `name` (≤64, `[a-z0-9-]`, `SKILL.md` → the directory's
 *   name, a reference → its basename), `description` (≤1,024, third person)
 *   — what the listing shows and what a plugin preloads; `order` and
 *   `audience` are ours and optional;
 * - the body opens with `## Read first` — the block an agent must not miss;
 * - links are RELATIVE and one level deep (`references/markup.md` from
 *   SKILL.md; `markup-data.md` or `../SKILL.md` from a reference), resolve
 *   to a file in the tree, and never reach inside another skill; a docs
 *   ADDRESS is `[[ base ]]/docs/…`, never a bare `/docs/` path or a
 *   hard-coded host, and never `{{ base` (the old delimiter, which would
 *   render literally);
 * - every rendered file ≤ 8,192 B and ≤ 500 lines; over 100 lines with three
 *   or more sections carries a `## Contents`; the listing is capped.
 *
 * `validateSkillTree` answers PROBLEMS as strings, so the guard test prints
 * every violation at once rather than the first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const SKILL_FILE_NAME = 'SKILL.md';
/** The always-read cap, per file: an agent pays for every byte on every turn it holds a page. */
export const SKILL_FILE_MAX_BYTES = 8192;
const SKILL_FILE_MAX_LINES = 500;
const SKILL_CONTENTS_THRESHOLD_LINES = 100;
/**
 * The listing's cap. Planned at 5,120 B; raised once, measured: descriptions
 * that say what the BRIEF ALREADY COVERS ("read this only for …") took pi's
 * planned fetches for a deck from 6 to 0 and a dashboard from 8 to 2, and
 * cost ~450 B of listing. Still small enough to fetch twice for nothing.
 */
export const SKILL_LISTING_MAX_BYTES = 6144;
const SKILL_READ_FIRST_HEADING = '## Read first';
const SKILL_READ_FIRST_MAX_BYTES = 2500;

export type SkillAudience = 'agent' | 'human';

export interface SkillFile {
  /** Tree-relative path: `artifact-bin/SKILL.md` or `artifact-bin/references/markup-data.md`. */
  path: string;
  /** The skill (top-level directory) it belongs to: `artifact-bin`. */
  dir: string;
  /** The file name: `SKILL.md` or `markup-data.md`. */
  file: string;
  /** True for a file under `references/`. */
  ref: boolean;
  name: string;
  description: string;
  /** Listing order inside its directory; `SKILL.md` is always first. */
  order: number;
  audience: SkillAudience;
  /** Per-file override of how far the `## Read first` block may run. */
  readFirstMax: number;
  /** The template source below the frontmatter. */
  body: string;
}

export interface SkillDir {
  name: string;
  skill: SkillFile;
  /** Every file of the directory, `SKILL.md` first, then by `order`, then by name. */
  files: SkillFile[];
}

export interface SkillTree {
  dirs: SkillDir[];
  /** Every file in listing order. */
  files: SkillFile[];
  get(path: string): SkillFile | undefined;
  dir(name: string): SkillDir | undefined;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const NAME_RE = /^[a-z0-9-]{1,64}$/;
const FILE_RE = /^[a-z0-9-]+\.md$/;

function parseSkillFile(filePath: string, text: string): SkillFile {
  const m = FRONTMATTER.exec(text);
  if (!m) throw new Error(`${filePath}: no YAML frontmatter`);
  const fm = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  const segments = filePath.split('/');
  const ref = segments.length === 3 && segments[1] === 'references';
  const skillFile = segments.length === 2 && segments[1] === SKILL_FILE_NAME;
  if (!skillFile && !ref) throw new Error(`${filePath}: a skill file is ${SKILL_FILE_NAME} or references/<file>.md under its skill — nothing else, nothing deeper`);
  const dir = segments[0];
  const file = segments[segments.length - 1];
  const name = typeof fm.name === 'string' ? fm.name : '';
  const description = typeof fm.description === 'string' ? fm.description.trim() : '';
  const order = typeof fm.order === 'number' ? fm.order : Number.MAX_SAFE_INTEGER;
  const audience: SkillAudience = fm.audience === 'human' ? 'human' : 'agent';
  const readFirstMax = typeof fm.read_first_max === 'number' ? fm.read_first_max : SKILL_READ_FIRST_MAX_BYTES;
  return { path: filePath, dir, file, ref, name, description, order, audience, readFirstMax, body: text.slice(m[0].length) };
}

export function buildSkillTree(sources: Record<string, string>): SkillTree {
  const files = Object.entries(sources).map(([p, text]) => parseSkillFile(p, text));
  const byDir = new Map<string, SkillFile[]>();
  for (const f of files) byDir.set(f.dir, [...(byDir.get(f.dir) ?? []), f]);
  const dirs: SkillDir[] = [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => {
      const skill = list.find((f) => f.file === SKILL_FILE_NAME);
      const ordered = [...list].sort((a, b) => {
        if (a.file === SKILL_FILE_NAME) return -1;
        if (b.file === SKILL_FILE_NAME) return 1;
        return a.order - b.order || a.file.localeCompare(b.file);
      });
      // A directory without a SKILL.md is reported by validateSkillTree; the
      // tree still holds it so the report can name it.
      return { name, skill: skill ?? ordered[0], files: ordered };
    });
  // The root skill leads the listing: it is the always-read.
  dirs.sort((a, b) => (a.name === ROOT_SKILL ? -1 : b.name === ROOT_SKILL ? 1 : a.name.localeCompare(b.name)));
  const all = dirs.flatMap((d) => d.files);
  const index = new Map(all.map((f) => [f.path, f]));
  return { dirs, files: all, get: (p) => index.get(p), dir: (n) => dirs.find((d) => d.name === n) };
}

/** The skill every agent reads first — today's brief. */
export const ROOT_SKILL = 'artifact-bin';

export function expectedSkillName(f: Pick<SkillFile, 'dir' | 'file' | 'ref'>): string {
  return f.ref ? f.file.replace(/\.md$/, '') : f.dir;
}

/** Relative markdown links in a body: `[text](target)`, code spans excluded. */
export function skillLinks(body: string): string[] {
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...noCode.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/**
 * Files NAMED in prose — `markup-data.md`, `references/design.md`,
 * `themes-<name>.md`. The tree points at its own files this way far more often
 * than it links them (the dispatch table and the reading path are both lists of
 * backticked names), and `skillLinks` deliberately strips code spans, so none
 * of these were ever checked: five names left over from the six-skill era
 * (`datasets.md`, `motion.md`, `data.md`) survived the port and sent an agent
 * to a file that does not exist. Read from the RENDERED text, so a name built
 * from the registries (`themes-[[ t.name ]].md`) is checked as what it becomes.
 */
export function skillFileMentions(body: string): string[] {
  const noFence = body.replace(/```[\s\S]*?```/g, '');
  return [...noFence.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1].trim())
    .filter((t) => MENTION_RE.test(t));
}

const MENTION_RE = /^(?:references\/)?[A-Za-z0-9-]+(?:<[a-z]+>)?[A-Za-z0-9-]*\.md$/;

/**
 * Does a mention name a file the tree holds? A directory prefix is decoration
 * (the tree is one skill, and a topic file is addressed by basename from the
 * brief and by `references/<file>` from a sibling), so the BASENAME decides.
 * A `<name>` placeholder stands for the registry names the docs enumerate
 * elsewhere, so it is satisfied by any file it matches — the point of the rule
 * is that no name leads nowhere, not that every expansion is spelled out.
 */
export function mentionResolves(tree: SkillTree, mention: string): boolean {
  const base = mention.replace(/^.*\//, '');
  // Matched by the two literal halves rather than by a RegExp built from the
  // text: a pattern is `<head><placeholder><tail>` and MENTION_RE admits one
  // placeholder, so `startsWith`/`endsWith` answers it exactly — and a name is
  // never compiled as a regex, which is where escaping bugs live.
  const placeholder = /<[a-z]+>/.exec(base);
  if (placeholder) {
    const head = base.slice(0, placeholder.index);
    const tail = base.slice(placeholder.index + placeholder[0].length);
    return tree.files.some((f) => f.file.length > head.length + tail.length && f.file.startsWith(head) && f.file.endsWith(tail));
  }
  return tree.files.some((f) => f.file === base);
}

/** Resolve a relative link from a file to a tree path, or null when it leaves the tree. */
export function resolveSkillLink(from: Pick<SkillFile, 'path'>, target: string): string | null {
  if (/^[a-z]+:/.test(target) || target.startsWith('/') || target.startsWith('#')) return null;
  const clean = target.replace(/[#?].*$/, '');
  const parts = [...from.path.split('/').slice(0, -1), ...clean.split('/')];
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') { if (!out.length) return null; out.pop(); continue; }
    if (p === '.' || p === '') continue;
    out.push(p);
  }
  if (out.length === 2 && out[1] === SKILL_FILE_NAME) return out.join('/');
  if (out.length === 3 && out[1] === 'references') return out.join('/');
  return null;
}

const THIRD_PERSON_VIOLATION = /(^|\s)(I |I'm |you can |you should )/i;

/**
 * Every rule the tree obeys, as problems. `rendered` gives a file's final
 * text (the guard renders with a fixed base so a hostname cannot move a
 * byte count); `listingBytes` the rendered `/docs` listing's size.
 */
export function validateSkillTree(tree: SkillTree, rendered: (f: SkillFile) => string, listingBytes?: number): string[] {
  const problems: string[] = [];
  for (const d of tree.dirs) {
    if (!d.files.some((f) => f.file === SKILL_FILE_NAME)) problems.push(`${d.name}/: no ${SKILL_FILE_NAME} — a directory is a skill`);
    if (!NAME_RE.test(d.name)) problems.push(`${d.name}/: directory name must be [a-z0-9-]`);
  }
  if (!tree.dir(ROOT_SKILL)) problems.push(`no ${ROOT_SKILL}/${SKILL_FILE_NAME} — the always-read skill`);
  for (const f of tree.files) {
    const at = f.path;
    if (!FILE_RE.test(f.file) && f.file !== SKILL_FILE_NAME) problems.push(`${at}: file names are [a-z0-9-]+.md`);
    if (!NAME_RE.test(f.name)) problems.push(`${at}: name "${f.name}" must be 1–64 chars of [a-z0-9-]`);
    if (/anthropic|claude/i.test(f.name)) problems.push(`${at}: name may not contain "anthropic" or "claude"`);
    if (f.name !== expectedSkillName(f)) problems.push(`${at}: name must be "${expectedSkillName(f)}" (directory, or directory-file)`);
    if (!f.description) problems.push(`${at}: description is required`);
    if (f.description.length > 1024) problems.push(`${at}: description over 1,024 chars`);
    if (THIRD_PERSON_VIOLATION.test(f.description)) problems.push(`${at}: description must be third person`);
    const firstHeading = /^#{1,6} .*$/m.exec(f.body)?.[0] ?? '';
    if (!firstHeading.startsWith(SKILL_READ_FIRST_HEADING)) problems.push(`${at}: the first heading must be "${SKILL_READ_FIRST_HEADING}" (got "${firstHeading || 'none'}")`);
    if (/\{\{\s*base/.test(f.body)) problems.push(`${at}: "{{ base" is the old delimiter — write [[ base ]]`);
    // A docs address is `[[ base ]]/docs/…` (rendered for the caller) or a
    // relative link; a bare `/docs/` is a wrong relative URL on disk, and a
    // hard-coded host is a URL that lies on every other deployment.
    if (/(?<!\]\])\/docs\//.test(f.body) || /\bhttps?:\/\/[^\s)]*\/docs\b/.test(f.body)) problems.push(`${at}: a docs address is [[ base ]]/docs/… or a relative link — never a bare /docs/ path or a hard-coded host`);
    for (const link of skillLinks(f.body)) {
      if (/^https?:/.test(link) || link.startsWith('#') || link.startsWith('mailto:')) continue;
      const to = resolveSkillLink(f, link);
      if (!to) { problems.push(`${at}: link "${link}" leaves the tree`); continue; }
      const target = tree.get(to);
      if (!target) { problems.push(`${at}: link "${link}" → ${to} does not exist`); continue; }
      if (target.dir !== f.dir && target.file !== SKILL_FILE_NAME) problems.push(`${at}: link "${link}" reaches inside another directory — link its ${SKILL_FILE_NAME}`);
    }
    const text = rendered(f);
    for (const mention of skillFileMentions(text)) {
      if (!mentionResolves(tree, mention)) problems.push(`${at}: "${mention}" names no file in the tree`);
    }
    const bytes = Buffer.byteLength(text);
    const lines = text.split('\n').length;
    if (bytes > SKILL_FILE_MAX_BYTES) problems.push(`${at}: ${bytes} B rendered, cap ${SKILL_FILE_MAX_BYTES}`);
    if (lines > SKILL_FILE_MAX_LINES) problems.push(`${at}: ${lines} lines, cap ${SKILL_FILE_MAX_LINES}`);
    const sections = (text.match(/^## /gm) ?? []).length;
    if (lines > SKILL_CONTENTS_THRESHOLD_LINES && sections >= 3 && !/^## Contents$/m.test(text)) problems.push(`${at}: ${lines} lines and ${sections} sections without a "## Contents"`);
    const rf = readFirstBlock(text);
    if (rf !== null && Buffer.byteLength(rf) > f.readFirstMax) problems.push(`${at}: the Read first block is ${Buffer.byteLength(rf)} B, cap ${f.readFirstMax}`);
  }
  if (listingBytes !== undefined && listingBytes > SKILL_LISTING_MAX_BYTES) problems.push(`the /docs listing is ${listingBytes} B, cap ${SKILL_LISTING_MAX_BYTES}`);
  return problems;
}

/** The text from `## Read first` to the next `## ` heading, or null when there is none. */
export function readFirstBlock(text: string): string | null {
  const at = text.indexOf(`${SKILL_READ_FIRST_HEADING}`);
  if (at < 0) return null;
  const rest = text.slice(at + SKILL_READ_FIRST_HEADING.length);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The tree on disk — `<root>/<skill>/SKILL.md` + `<root>/<skill>/references/*.md`, nothing else, nothing loose at the root. */
export function loadSkillSources(root = path.resolve(process.cwd(), 'skills')): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of readdirSync(root)) {
    const full = path.join(root, dir);
    if (!statSync(full).isDirectory()) throw new Error(`skills/${dir}: loose files at the root are not skills — every file lives in a directory`);
    for (const entry of readdirSync(full)) {
      const entryPath = path.join(full, entry);
      if (statSync(entryPath).isDirectory()) {
        if (entry !== 'references') throw new Error(`skills/${dir}/${entry}: only a references/ folder may nest inside a skill`);
        for (const file of readdirSync(entryPath)) {
          if (!file.endsWith('.md')) continue;
          out[`${dir}/references/${file}`] = readFileSync(path.join(entryPath, file), 'utf8');
        }
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      out[`${dir}/${entry}`] = readFileSync(entryPath, 'utf8');
    }
  }
  return out;
}
