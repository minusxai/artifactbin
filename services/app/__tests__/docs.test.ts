/**
 * The /docs/* surface — ONE route over the skills tree (`lib/skills`): the
 * listing at /docs (and /llms.txt), a skill's files at /docs/<skill>, a file
 * at /docs/<skill>/<file>.md, the tree as a folder at /docs?download=true,
 * the human tour at /docs/human, and /docs redirecting a browser there.
 * Route handler in-process.
 */
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GET as docs } from '@/app/docs/[[...path]]/route';
import { DOCS_INDEX_MAX_BYTES, renderDoc, skillTree } from '@/lib/skills';
import { STORY_HTML_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { STORY_TEMPLATE_NAMES, STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';
import { request } from '@/__tests__/harness';

const BASE = 'http://localhost:3000';
const docsResponse = (path: string, headers: Record<string, string> = {}) =>
  docs(request(`/docs${path}`, { headers }), { params: Promise.resolve({ path: path.replace(/^\//, '').replace(/\?.*$/, '') }) });
const markdown = async (res: Response) => {
  expect(res.status).toBe(200);
  // text/plain, not text/markdown: see MARKDOWN_CONTENT_TYPE — the readers
  // agents actually use reject the markdown type, and these docs exist to be
  // read by agents.
  expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  return res.text();
};

describe('the auth doc', () => {
  it('tells the user how to keep anonymous work under an account', () => {
    const doc = renderDoc('artifact-bin/references/publishing-auth.md', BASE);
    expect(doc).toMatch(new RegExp(`log in at ${BASE}`, 'i'));
    expect(doc).toContain('/api/tokens/anonymous');
    expect(doc).not.toContain('[[');
  });

  it('counts the vocabulary instead of restating it', () => {
    const doc = renderDoc('artifact-bin/references/markup.md', BASE);
    expect(doc).toContain(`${STORY_HTML_TAGS.length} are allowed`);
    expect(doc).toContain(`Kit components (${STORY_UI_COMPONENT_NAME_LIST.length})`);
  });
});

/**
 * The docs are the product's entire onboarding: an agent is told to read one
 * URL. If a web reader cannot fetch it, nothing else works.
 */
describe('agent-readable delivery', () => {
  it('serves the listing, a skill, and every file as text/plain, never text/markdown', async () => {
    for (const path of ['', '/artifact-bin', '/artifact-bin/references', ...skillTree().files.map((f) => `/${f.path}`)]) {
      const res = await docsResponse(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Content-Type'), path).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
      expect((await res.text()).length, path).toBeGreaterThan(300);
    }
  });
});

describe('the listing', () => {
  /**
   * `/docs` is the address an agent guesses first, and it used to send every
   * caller to the page written for people. Measured: Claude Code asked twice,
   * followed the redirect, and kept guessing — `/api/docs`, `/api/components`,
   * `/api/artifacts/<id>/schema`, `/llms.txt` — reaching the protocol on its
   * tenth request. The split is by what the caller ASKED FOR (ordinary content
   * negotiation), not by the UA guess in `lib/client-identity`.
   */
  it('sends a browser to the human tour, from /docs and from a skill', async () => {
    for (const path of ['', '/artifact-bin']) {
      const res = await docsResponse(path, { accept: 'text/html,application/xhtml+xml' });
      expect(res.status, path).toBe(307);
      expect(res.headers.get('location')).toContain('/docs/human');
    }
  });

  it('answers anything else with one line per file — URL and when to read it — the brief first, and no second copy of any doc', async () => {
    const text = await markdown(await docsResponse(''));
    const urls = text.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t')[0]);
    expect(urls[0]).toBe(`${BASE}/docs/artifact-bin/SKILL.md`);
    expect(urls).toHaveLength(skillTree().files.length);
    for (const f of skillTree().files) expect(urls).toContain(`${BASE}/docs/${f.path}`);
    expect(text).toContain('download=true');
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(DOCS_INDEX_MAX_BYTES);
    expect(text).not.toContain('## Endpoints');
  });

  it('the skill lists its own files, its SKILL.md first', async () => {
    const text = await markdown(await docsResponse('/artifact-bin'));
    const urls = text.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t')[0]);
    expect(urls[0]).toBe(`${BASE}/docs/artifact-bin/SKILL.md`);
    expect(urls.slice(1).every((u) => u.startsWith(`${BASE}/docs/artifact-bin/references/`))).toBe(true);
    expect(urls.length).toBe(skillTree().dir('artifact-bin')!.files.length);
  });
});

describe('files', () => {
  it('renders a file with the caller\'s own base baked in and no template syntax', async () => {
    const text = await markdown(await docsResponse('/artifact-bin/references/publishing.md'));
    expect(text).toContain(`POST ${BASE}/api/artifacts`);
    expect(text).toContain('Authorization: Bearer mx_');
    expect(text).not.toMatch(/\[\[|\]\]|\[%/);
    expect(text.startsWith('## Read first')).toBe(true);
  });

  it('serves one theme and one template in full, and their indexes name every one', async () => {
    const themes = await markdown(await docsResponse('/artifact-bin/references/themes.md'));
    for (const name of STORY_THEME_NAMES) expect(themes).toContain(`](themes-${name}.md)`);
    expect(themes).not.toContain('Charts:');
    expect(await markdown(await docsResponse('/artifact-bin/references/themes-modernist.md'))).toContain('Charts:');
    const templates = await markdown(await docsResponse('/artifact-bin/references/templates.md'));
    for (const name of STORY_TEMPLATE_NAMES) expect(templates).toContain(`](templates-${name}.md)`);
    expect(templates).not.toContain('Beats:');
    const editorial = await markdown(await docsResponse('/artifact-bin/references/templates-editorial.md'));
    expect(editorial).toContain('Beats:');
    expect(editorial).toContain('Type register');
  });

  it('names the fix on a miss: the nearest directory\'s children, as JSON', async () => {
    const missing = await docsResponse('/artifact-bin/references/themes-vaporwave.md');
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as { error: string; children: string[] };
    expect(body.error).toBe('not_found');
    expect(body.children).toContain(`${BASE}/docs/artifact-bin/references/themes.md`);
    expect(body.children).toContain(`${BASE}/docs/artifact-bin/references/themes-modernist.md`);
    const noSkill = await docsResponse('/zines');
    expect(noSkill.status).toBe(404);
    expect(((await noSkill.json()) as { children: string[] }).children).toContain(`${BASE}/docs/artifact-bin/SKILL.md`);
    expect((await docsResponse('/artifact-bin/references/markup-data.md/deeper')).status).toBe(404);
  });

  it('retired addresses are 404s that name the tree, never silent aliases', async () => {
    for (const old of ['/llm', '/artifact-design', '/publishing', '/publishing/SKILL.md', '/markup/SKILL.md', '/markup/data.md', '/themes/industry.md', '/templates/deck.md', '/design/SKILL.md']) {
      expect((await docsResponse(old)).status, old).toBe(404);
    }
  });
});

/**
 * Measured (~/projects/improved-skills-v2.md §14): handed the docs as a
 * FOLDER, pi ran `grep -rl SlideDeck docs/`, opened the one file that matched
 * whole, and its deck task's docs reads went 12 → 2. The archive is the
 * plugin's `skills/` — one render, one code path.
 */
describe('/docs?download=true', () => {
  it('is a gzipped ustar of skills/<skill>/<file>.md with frontmatter, byte-stable, and only at the root', async () => {
    const res = await docs(new Request(`${BASE}/docs?download=true`), { params: Promise.resolve({ path: undefined }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/gzip');
    expect(res.headers.get('Content-Disposition')).toContain('.tar.gz');
    const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
    const names: string[] = [];
    for (let at = 0; at + 512 <= tar.length; ) {
      const name = tar.subarray(at, at + 100).toString('utf8').replace(/\0.*$/, '');
      if (!name) break;
      const size = parseInt(tar.subarray(at + 124, at + 136).toString('ascii'), 8);
      expect(tar.subarray(at + 257, at + 262).toString('ascii')).toBe('ustar');
      if (!name.endsWith('/')) {
        names.push(name);
        const body = tar.subarray(at + 512, at + 512 + size).toString('utf8');
        expect(body.startsWith('---\nname: '), name).toBe(true);
        expect(body, name).not.toMatch(/\[\[|\[%/);
        if (name === 'skills/artifact-bin/SKILL.md') expect(body).toContain(BASE);
      }
      at += 512 + Math.ceil(size / 512) * 512;
    }
    expect(names).toContain('skills/artifact-bin/SKILL.md');
    expect(names).toContain('skills/artifact-bin/references/markup-data.md');
    expect(names).toHaveLength(skillTree().files.length);
    const again = await docs(new Request(`${BASE}/docs?download=true`), { params: Promise.resolve({ path: undefined }) });
    expect(Buffer.from(await again.arrayBuffer()).equals(Buffer.from(await (await docs(new Request(`${BASE}/docs?download=true`), { params: Promise.resolve({ path: undefined }) })).arrayBuffer()))).toBe(true);
    // Only the whole tree downloads; a file is a file.
    const file = await docs(new Request(`${BASE}/docs/artifact-bin/references/markup-data.md?download=true`), { params: Promise.resolve({ path: 'artifact-bin/references/markup-data.md' }) });
    expect(file.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });
});
