import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compilePage, generate } from '../../compiler';
import { loadCompilerBuild } from '../../build.server';
import { corpus } from './corpus';
import { inputOf, parsedDomDiffs } from './harness';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/jsx/component-names';
import { JSDOM } from 'jsdom';
import { applyCurrentLayoutContracts } from '@/lib/islands/__tests__/kit-parity';

const baseline = JSON.parse(readFileSync(new URL('./react-html.json', import.meta.url), 'utf8')) as Record<string, string>;
// FileUpload was introduced after the React reader retired. Its reviewed Solid SSR contract
// supplements the frozen React corpus; every historical component remains compared to that capture.
const uploadBaseline = JSON.parse(readFileSync(new URL('./upload-html.json', import.meta.url), 'utf8')) as Record<string, string>;
function expectedHtml(key: string): string {
  if (key === 'file-upload') return uploadBaseline[key]!;
  const html = applyCurrentLayoutContracts(baseline[key]!);
  if (key !== 'kitchen-sink') return html;
  const root = new JSDOM(`<main>${html}</main>`).window.document.querySelector('main')!;
  const switchShell = root.querySelector('[role="switch"][aria-label="Compare"]')?.closest('.mx-control');
  if (!switchShell) throw new Error('kitchen-sink capture lost the Compare control anchor');
  switchShell.insertAdjacentHTML('afterend', '\n    ' + uploadBaseline['kitchen-sink-upload']!);
  // Adding a kit island changes the fixture's serialized literal table, not historical DOM.
  const literals = [...root.querySelectorAll('script')].find(node => node.textContent?.startsWith('{"moduleData"'));
  if (!literals) throw new Error('kitchen-sink capture lost its literal table');
  literals.textContent = uploadBaseline['kitchen-sink-literals']!;
  return root.innerHTML;
}


// One-tree SSR retains closed panels and portal homes; compare the React capture's visible surface.
const visibleHtml = (html: string): string => {
  const root = new JSDOM(`<main>${html}</main>`).window.document.querySelector('main')!;
  // Rail templates are inert until deck behavior moves their thumbnails into place.
  root.querySelectorAll('template').forEach(node => node.remove());
  root.querySelectorAll('[hidden]').forEach(node => node.remove());
  root.querySelectorAll('[data-mx-theme-host]').forEach(node => node.parentElement?.remove());
  root.querySelectorAll('pre').forEach(node => { if (node.firstChild?.nodeType === 3) node.firstChild.textContent = node.firstChild.textContent?.replace(/^\n+/, '') ?? ''; });
  root.querySelectorAll('[data-hk]').forEach(node => node.removeAttribute('data-hk'));
  root.querySelectorAll('[data-mx-live]').forEach(node => node.removeAttribute('data-mx-live'));
  // The delegated dialog close marker is internal; it does not change visible reader output.
  root.querySelectorAll('[data-mx-dialog-close]').forEach(node => node.removeAttribute('data-mx-dialog-close'));
  for (const node of root.querySelectorAll<HTMLElement>('[id],[aria-controls],[aria-labelledby],[aria-describedby]')) {
    for (const name of ['id', 'aria-controls', 'aria-labelledby', 'aria-describedby']) {
      const value = node.getAttribute(name);
      if (value && /^(?:s\d+-|d-|radix-_R_|mx-preview-)/.test(value)) node.removeAttribute(name);
    }
  }
  return root.innerHTML;
};

describe('Solid static render parity', () => {
  it('compares parsed element attributes and text exactly, with comments separate', () => {
    const report = parsedDomDiffs('<div class="a b" style="color:red"><input disabled="">a<!--react-->b</div>', '<div style="color:red" class="a b"><input disabled>a<!--solid-->b</div>');
    expect(report.dom).toEqual([]);
    expect(report.comments).toHaveLength(1);
    expect(parsedDomDiffs('<p class="a b">one</p>', '<p class="b a">one</p>').dom).toHaveLength(1);
    expect(parsedDomDiffs('<p data-hk="a">text</p>', '<p data-hk="b">text</p>').dom).toHaveLength(1);
  });
  it('covers every registered tag in the corpus', async () => {
    const seen = new Set<string>();
    const visit = (node: JsxNode): void => {
      if (node.type !== 'element') return;
      seen.add(node.tag);
      node.children.forEach(visit);
    };
    for (const doc of await corpus()) (parseJsx(doc.markup) as { nodes: JsxNode[] }).nodes.forEach(visit);
    expect(STORY_UI_COMPONENT_NAME_LIST.filter((tag) => !seen.has(tag))).toEqual([]);
  });
  it('matches the captured React HTML except Solid hydration keys and generated rail IDs', async () => {
    const build = loadCompilerBuild();
    const reports = [];
    for (const doc of await corpus()) {
      const input = await inputOf(doc);
      const page = await compilePage(input, build);
      const generated = generate({ ...input, glyphCatalogUrl: build.manifest['@mx/glyphs'] });
      const expected = expectedHtml(doc.key);
      const parsed = parsedDomDiffs(visibleHtml(expected), visibleHtml(page.html));
      reports.push({ key: doc.key, dom: parsed.dom, hydrationKeys: parsed.hydrationKeys, generatedIds: parsed.generatedIds,
        contentDom: parsed.dom.filter((diff) => !parsed.hydrationKeys.includes(diff) && !parsed.generatedIds.includes(diff)),
        scripts: parsed.scripts.length, comments: parsed.comments.length });
      expect(generated.skeleton, doc.key).not.toContain('<mx-static');
      expect(page.reactStatic, doc.key).toEqual([]);
    }
    if (process.env.P3_REPORT_DIR) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.P3_REPORT_DIR}/parity.json`, JSON.stringify(reports, null, 2));
    }
    expect(reports.flatMap((report) => report.contentDom.map((diff) => `${report.key}: ${diff}`))).toEqual([]);
    // The deleted per-island shell assigned hydration prefixes and rail IDs that the one-tree renderer cannot preserve.
    expect(reports).toHaveLength(35);
  }, 300_000);
});
