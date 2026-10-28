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
 it('keeps one written core, current or legacy, without duplicating it',()=>{
  for(const src of ['/af/core.js','/af/v1/core.js']){
   const html=canonicalizeHtmlPage(page(`<script src="${src}" data-af="core"></script><title>T</title>`)).html;
   expect(cores(html)).toEqual([src]);
  }
 });
});
