import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compilePage, generate } from '../../compiler';
import { loadCompilerBuild } from '../../build.server';
import { corpus } from './corpus';
import { inputOf, parsedDomDiffs } from './harness';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';

const baseline = JSON.parse(readFileSync(new URL('./react-html.json', import.meta.url), 'utf8')) as Record<string, string>;

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
      const parsed = parsedDomDiffs(baseline[doc.key]!, page.html);
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
    expect(reports.reduce((sum, report) => sum + report.hydrationKeys.length, 0)).toBe(44);
    expect(reports.reduce((sum, report) => sum + report.generatedIds.length, 0)).toBe(3);
    expect(reports).toHaveLength(35);
  }, 300_000);
});
