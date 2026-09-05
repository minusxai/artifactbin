/** Planning experiments against existing code; no production identity implementation. */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseJsx } from '@/lib/jsx';
import { assignNodeKeys } from '@/lib/story-ui/node-identity';
import { canonicalizeMarkup } from '../jsx-tier';
import { deriveSpliceFromStrings, touchedSpanFor, spansOverlap, applySplice } from '../splice';
import { getDb } from '@/lib/db';
import { useAppHarness } from '@/__tests__/harness';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconGlyphProvider } from '@/components/kit/icon';
import { FALLBACK_ICON_KEY } from '@/lib/story-ui/icon-contract';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { kitchenSinkMarkup } from '../kitchen-sink';
import type { JsxNode } from '@/lib/jsx';

const nodes = (source: string) => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};

describe('node identity planning counterexamples', () => {
  useAppHarness();
  it('executes all four captured OpenCode GLM-5.3 edit responses through the existing kernel', () => {
    const list = '<ul id="list"><li id="aaaa">Same</li><li id="bbbb">Same</li><li id="cccc">Same</li></ul>';
    const cases = [
      {source:'<section id="root"><p id="aaaa">active</p><p id="bbbb">active</p></section>', old:'id="bbbb">active', next:'id="bbbb">blocked', expected:'<section id="root"><p id="aaaa">active</p><p id="bbbb">blocked</p></section>'},
      {source:list, old:'<li id="bbbb">Same</li>', next:'', expected:'<ul id="list"><li id="aaaa">Same</li><li id="cccc">Same</li></ul>'},
      {source:list, old:'<li id="bbbb">Same</li>', next:'<li id="bbbb">Same</li><li>New</li>', expected:'<ul id="list"><li id="aaaa">Same</li><li id="bbbb">Same</li><li>New</li><li id="cccc">Same</li></ul>'},
      {source:list, old:'<li id="aaaa">Same</li><li id="bbbb">Same</li><li id="cccc">Same</li>', next:'<li id="cccc">Same</li><li id="aaaa">Same</li><li id="bbbb">Same</li>', expected:'<ul id="list"><li id="cccc">Same</li><li id="aaaa">Same</li><li id="bbbb">Same</li></ul>'},
    ];
    for (const c of cases) {
      const result = deriveSpliceFromStrings(c.source, c.old, c.next);
      if (!result.ok) throw new Error(result.reason);
      expect(applySplice(c.source, result.splice)).toBe(c.expected);
    }
  });
  it('compares HTML id forwarding to existing path forwarding across the actual SSR kitchen sink', () => {
    const tree = nodes(kitchenSinkMarkup({dataset: 'aaaaaa', recipe: 'bbbbbb', image: 'cccccc', pdf: 'dddddd'}));
    const expected = new Map<string, string>();
    const stamp = (list: JsxNode[], base = '') => list.forEach((node, i) => {
      if (node.type !== 'element' || node.tag === 'Helmet') return;
      const path = base ? `${base}.${i}` : String(i);
      node.attributes = node.attributes.filter(a => a.name !== 'id');
      node.attributes.push({name: 'id', value: {static: true, json: `probe-${path}`}, start: 0, end: 0});
      expected.set(path, node.tag);
      stamp(node.children, path);
    });
    stamp(tree);
    const glyphs = {[FALLBACK_ICON_KEY]: {cls: 'lucide-badge-question-mark', inner: '<path d="" />'}};
    const html = renderToStaticMarkup(createElement(IconGlyphProvider, {value: glyphs}, renderStoryNodes(tree, {components: STORY_UI_COMPONENTS})));
    const doc = new JSDOM(html).window.document;
    const paths = [...doc.querySelectorAll('[data-mx-ast]')].map(el => el.getAttribute('data-mx-ast')!);
    const missing = paths.filter(path => expected.has(path) && !doc.getElementById(`probe-${path}`));
    console.log(JSON.stringify({probe: 'SSR id forwarding', sourceNodes: expected.size, renderedPaths: new Set(paths).size, missingIdsForRenderedPaths: missing, sourceNodesWithoutDOMId: [...expected].filter(([path]) => !doc.getElementById(`probe-${path}`)).map(([,tag])=>tag)}));
    expect(missing).toEqual([]);
    expect(paths.length).toBeGreaterThan(50);
  });
  it('rehearses atomic source/relation migration, crash rollback, and idempotent resume in PGLite', async () => {
    const db = await getDb();
    await db.query('CREATE TEMP TABLE planning_identity (id text PRIMARY KEY, source text, anchor text, version int)');
    await db.query(`INSERT INTO planning_identity VALUES ('doc', '<p id="intro" data-annotation-anchor="oldKey">Hello</p>', 'oldKey', 1)`);
    const migrate = async (crash: boolean) => db.transaction(async tx => {
      const row = (await tx.query<{source: string; anchor: string; version: number}>("SELECT * FROM planning_identity WHERE id = 'doc' FOR UPDATE")).rows[0];
      if (row.anchor === 'intro') return;
      await tx.query("UPDATE planning_identity SET source = $1, version = version + 1 WHERE id = 'doc'", [row.source.replace(' data-annotation-anchor="oldKey"', '')]);
      if (crash) throw new Error('injected crash');
      await tx.query("UPDATE planning_identity SET anchor = 'intro' WHERE id = 'doc'");
    });
    await expect(migrate(true)).rejects.toThrow('injected crash');
    expect((await db.query('SELECT anchor, version FROM planning_identity')).rows).toEqual([{anchor: 'oldKey', version: 1}]);
    await migrate(false);
    await migrate(false);
    expect((await db.query('SELECT anchor, version FROM planning_identity')).rows).toEqual([{anchor: 'intro', version: 2}]);
    await db.query('DROP TABLE planning_identity');
    // This proves local transaction mechanics, not production Postgres locking or artifact history integration.
  });
  it('React identity follows position for indistinguishable siblings: it cannot establish comment identity', () => {
    const before = nodes('<p>Same</p><p>Same</p>');
    const keys = assignNodeKeys(before);
    // The human deleted the FIRST paragraph. Source alone cannot establish this.
    const after = assignNodeKeys(nodes('<p>Same</p>'), { nodes: before, keys });
    expect(after.keyFor('0')).toBe(keys.keyFor('0'));
    expect(after.keyFor('0')).not.toBe(keys.keyFor('1'));
  });

  it('a same-tag replacement inherits a React key despite entirely unrelated text', () => {
    const before = nodes('<p>Revenue grew</p>');
    const keys = assignNodeKeys(before);
    const after = assignNodeKeys(nodes('<p>Office closed</p>'), { nodes: before, keys });
    expect(after.keyFor('0')).toBe(keys.keyFor('0'));
  });

  it('authored ids and legacy anchors coexist in canonical source', () => {
    const source = '<p id="intro" data-annotation-anchor="oldKey">Hello</p>';
    expect(canonicalizeMarkup(source)).toBe(source);
    const dom = new JSDOM(source.replace(' data-annotation-anchor="oldKey"', ''));
    expect(dom.window.document.querySelector('[id="oldKey"]')).toBeNull();
    expect(dom.window.document.getElementById('intro')).not.toBeNull();
  });

  it('scoped lookup does not repair global getElementById with duplicate preview ids', () => {
    const doc = new JSDOM('<aside><p id="intro">preview</p></aside><main><p id="intro">document</p></main>').window.document;
    expect(doc.getElementById('intro')?.textContent).toBe('preview');
    expect(doc.querySelector('main [id="intro"]')?.textContent).toBe('document');
  });

  it('reusing a deleted id makes lookup attach an old relation to unrelated content', () => {
    const relation = { nodeId: 'a001', quote: 'Revenue grew' };
    const doc = new JSDOM('<p id="a001">Office closed</p>').window.document;
    expect(doc.getElementById(relation.nodeId)?.textContent).toBe('Office closed');
    expect(doc.getElementById(relation.nodeId)?.textContent).not.toBe(relation.quote);
  });

  it('nearest id makes repeated labels exact-once while sibling conflict spans remain disjoint', () => {
    const source = '<div id="root"><p id="aaaa">active</p><p id="bbbb">active</p></div>';
    expect(deriveSpliceFromStrings(source, 'active', 'blocked')).toEqual({ ok: false, reason: 'multiple_matches' });
    const a = deriveSpliceFromStrings(source, '<p id="aaaa">active</p>', '<p id="aaaa">blocked</p>');
    const b = deriveSpliceFromStrings(source, '<p id="bbbb">active</p>', '<p id="bbbb">done</p>');
    if (!a.ok || !b.ok) throw new Error('expected unique anchors');
    expect(spansOverlap(touchedSpanFor(source, a.splice), touchedSpanFor(source, b.splice))).toBe(false);
    expect(a.splice.removed).toBe('<p id="aaaa">active</p>');
  });

  it('quoting a whole section causes a conflict despite a one-word intended change', () => {
    const source = '<section id="root"><p id="aaaa">active</p><p id="bbbb">active</p></section>';
    const a = deriveSpliceFromStrings(source, source, source.replace('active', 'blocked'));
    const b = deriveSpliceFromStrings(source, '<p id="bbbb">active</p>', '<p id="bbbb">done</p>');
    if (!a.ok || !b.ok) throw new Error('expected unique anchors');
    expect(spansOverlap(touchedSpanFor(source, a.splice), touchedSpanFor(source, b.splice))).toBe(true);
  });

  it('letter-first four-character capacity differs from unrestricted base62', () => {
    expect(52 * 62 ** 3).toBe(12_393_056);
    expect(62 ** 4).toBe(14_776_336);
    // Tiny valid markup is the byte-overhead adversary, not a prose sample.
    const before = '<i />'.repeat(1000);
    const after = '<i id="a001" />'.repeat(1000);
    expect((Buffer.byteLength(after) - Buffer.byteLength(before)) / Buffer.byteLength(before)).toBe(2);
  });
});
