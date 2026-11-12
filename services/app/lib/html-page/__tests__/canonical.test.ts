import { applyEdits, attribute, insertAttribute, parseSource } from '../html-source';
import { describe, expect, it } from 'vitest';
import { canonicalizeHtmlPage } from '../index';

describe('canonical HTML publication', () => {
 it('places one blocking core before authored scripts and identifies every element', () => {
  const page=canonicalizeHtmlPage('<!doctype html><html><head><script>run()</script></head><body><p>Hello</p></body></html>');
  expect(page.html.indexOf('src="/af/core.js"')).toBeLessThan(page.html.indexOf('run()'));
  expect(page.nodeIds).toHaveLength(6);
  expect(new Set(page.nodeIds).size).toBe(6);
 });
 it('preserves author bytes and stable IDs on repeated saves',()=>{
  const first=canonicalizeHtmlPage('<html><head></head><body><p class="x">Hello &amp; hi</p></body></html>');
  const second=canonicalizeHtmlPage(first.html,{previousHtml:first.html,ledger:first.ledger});
  expect(second).toEqual(first);
  expect(second.html).toContain('class="x"');
  expect(second.html).toContain('Hello &amp; hi');
 });
 it('never reuses a removed identity and rejects resurrection',()=>{
  const first=canonicalizeHtmlPage('<html><head></head><body><p data-af-id="old">Hello</p></body></html>');
  const removed=canonicalizeHtmlPage(first.html.replace(/<p[^>]*>Hello<\/p>/,''),{previousHtml:first.html,ledger:first.ledger});
  expect(()=>canonicalizeHtmlPage(removed.html.replace('</body>','<p data-af-id="old">new</p></body>'),{previousHtml:removed.html,ledger:removed.ledger})).toThrow('retired');
  const added=canonicalizeHtmlPage(removed.html.replace('</body>','<p>new</p></body>'),{previousHtml:removed.html,ledger:removed.ledger});
  expect(added.ledger.nextNodeId).toBeGreaterThan(removed.ledger.nextNodeId);
 });
 it('rejects duplicate identities including templates',()=>{
  expect(()=>canonicalizeHtmlPage('<p data-af-id="x"></p><template><p data-af-id="x"></p></template>')).toThrow('Duplicate');
 });
});

describe('the core script is platform-added: pages work with or without it',()=>{
 const page=(head:string)=>`<!doctype html><html><head><meta charset="utf-8">${head}</head><body><h1>Hi</h1></body></html>`;
 const cores=(html:string)=>[...html.matchAll(/<script[^>]*src="(\/af\/(?:v1\/)?core\.js)"/g)].map(match=>match[1]);
 it('adds exactly one core, first in head, when the page has none',()=>{
  const html=canonicalizeHtmlPage(page('<title>T</title>')).html;
  expect(cores(html)).toEqual(['/af/core.js']);
  expect(html.indexOf('/af/core.js')).toBeLessThan(html.indexOf('<title'));
 });
 it('keeps one current written core without duplicating it',()=>{
  for(const src of ['/af/core.js']){
   const html=canonicalizeHtmlPage(page(`<script src="${src}" data-af="core"></script><title>T</title>`)).html;
   expect(cores(html)).toEqual([src]);
  }
 });
});

it('inserts source-minimal double-quoted attributes and round-trips entities', () => {
 const source = '<p>unchanged &amp; text</p>';
 const value = `a&b"c<d>e'f &quot;`;
 const element = parseSource(source).elements.find(element => element.tagName === 'p')!;
 const result = applyEdits(source, [insertAttribute(source, element, 'data-value', value)]);
 expect(result).toBe(`<p data-value="a&amp;b&quot;c<d>e'f &amp;quot;">unchanged &amp; text</p>`);
 expect(attribute(parseSource(result).elements.find(element => element.tagName === 'p')!, 'data-value')).toBe(value);
});

describe('inline elements inside editable regions carry no identity',()=>{
 const ids=(html:string)=>parseSource(html).elements.filter(element=>attribute(element,'data-af-id')!==null).map(element=>element.tagName);
 const body=(html:string)=>canonicalizeHtmlPage(`<!doctype html><html><head></head><body>${html}</body></html>`).html;
 it('gives no id to a, strong, b, em, i or code in a rich region, and still identifies its blocks',()=>{
  const html=body('<section data-af-editable="rich"><p>Hi <a href="https://x.dev">l</a> <strong>s</strong> <b>b</b> <em>e</em> <i>i</i> <code>c</code></p><ul><li>item <em>x</em></li></ul></section>');
  expect(ids(html)).toEqual(['html','head','script','body','section','p','ul','li']);
  expect(html).toContain('<strong>s</strong> <b>b</b> <em>e</em> <i>i</i> <code>c</code>');
 });
 it('gives no id to inline elements in a text region',()=>{
  expect(ids(body('<h1 data-af-editable="text">Plain <em>word</em></h1>'))).toEqual(['html','head','script','body','h1']);
 });
 it('gives no id to code inside pre in a region, while pre keeps one',()=>{
  const html=body('<div data-af-editable="rich"><pre><code>let x = 1;</code></pre></div>');
  expect(ids(html)).toEqual(['html','head','script','body','div','pre']);
  expect(html).toMatch(/<pre data-af-id="[^"]+"><code>let x = 1;<\/code><\/pre>/);
 });
 it('strips inline ids already in the source of a region, keeping every other byte',()=>{
  const source='<!doctype html><html><head></head><body><div data-af-editable="rich" data-af-id="r"><p data-af-id="p">A <strong data-af-id="s1">bold</strong> <a  data-af-id="l1" href="https://x.dev">link</a> <pre data-af-id="pre"><code data-af-id="c1">x</code></pre></p></div></body></html>';
  const page=canonicalizeHtmlPage(source);
  expect(page.html).toContain('<p data-af-id="p">A <strong>bold</strong> <a href="https://x.dev">link</a>');
  expect(page.html).toContain('<code>x</code>');
  for(const id of ['s1','l1','c1'])expect(page.nodeIds).not.toContain(id);
  for(const id of ['r','p','pre'])expect(page.nodeIds).toContain(id);
  // A repeat save is stable.
  const again=canonicalizeHtmlPage(page.html,{previousHtml:page.html,ledger:page.ledger});
  expect(again.html).toBe(page.html);
  expect(new Set(again.nodeIds)).toEqual(new Set(page.nodeIds));
 });
 it('leaves inline ids outside regions, and under a non-region data-af-editable value, unchanged',()=>{
  const outside=body('<p>Out <strong>bold</strong> <code>c</code></p><div data-af-editable="other"><em>e</em></div>');
  expect(ids(outside)).toEqual(['html','head','script','body','p','strong','code','div','em']);
  const kept=canonicalizeHtmlPage('<!doctype html><html><head></head><body><p><strong data-af-id="keep">x</strong></p></body></html>');
  expect(kept.nodeIds).toContain('keep');
 });
 it('uses the nearest data-af-editable ancestor',()=>{
  const html=body('<div data-af-editable="other"><div data-af-editable="rich"><p><em>in</em></p></div></div><div data-af-editable="rich"><div data-af-editable="other"><p><em>out</em></p></div></div>');
  expect(ids(html)).toEqual(['html','head','script','body','div','div','p','div','div','p','em']);
 });
});
