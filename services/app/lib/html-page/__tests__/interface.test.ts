/**
 * html-page's remaining doors: the core-script repair publish and autofix share, the head metadata a listing
 * reads, the backend declarations, and the html-source leaf's offset-preserving edits.
 */
import {describe,expect,it} from 'vitest';
import {htmlBackendNames,htmlPageMetadata,isRuntimeCoreSrc,repairCoreScript} from '../index';
import {RUNTIME_CORE_PATH} from '../core-script';
import {applyEdits,atHeadStart,insertAttribute,parseSource,removeElement} from '../html-source';

const element=(source:string,tag:string,at=0)=>parseSource(source).elements.filter(node=>node.tagName===tag)[at]!;

describe('the core script',()=>{
 it('has one flat address, and the legacy alias is still recognized',()=>{
  expect(RUNTIME_CORE_PATH).toBe('/af/core.js');
  expect(isRuntimeCoreSrc(RUNTIME_CORE_PATH)).toBe(true);
  expect(isRuntimeCoreSrc('/af/v1/core.js')).toBe(true);
  for(const src of [null,undefined,'','/af/core.js?v=2','https://cdn.example/af/core.js','/af/v2/core.js'])expect(isRuntimeCoreSrc(src)).toBe(false);
 });

 it('leaves a page whose core is already the first plain head script byte-identical',()=>{
  const html='<!doctype html><html><head><script src="/af/core.js"></script><script>x()</script></head><body></body></html>';
  expect(repairCoreScript(html)).toEqual({html,changed:false,removed:[]});
 });

 it('adds a missing core first in the head, and an empty document gains one too',()=>{
  const repaired=repairCoreScript('<html><head><title>T</title></head><body></body></html>');
  expect(repaired.changed).toBe(true);
  expect(repaired.removed).toEqual([]);
  expect(repaired.html).toBe('<html><head><script src="/af/core.js"></script><title>T</title></head><body></body></html>');
  expect(repairCoreScript('').html).toBe('<script src="/af/core.js"></script>');
 });

 it('collapses duplicated, async or misplaced cores into one, keeping the first identity escaped',()=>{
  const html='<html><head><title>T</title><script async src="/af/v1/core.js" data-af-id="c&quot;1"></script></head><body><script src="/af/core.js"></script></body></html>';
  const repaired=repairCoreScript(html);
  expect(repaired.removed).toHaveLength(2);
  expect(repaired.html).toBe('<html><head><script src="/af/core.js" data-af-id="c&quot;1"></script><title>T</title></head><body></body></html>');
  // Idempotent: the repaired page needs nothing more.
  expect(repairCoreScript(repaired.html).changed).toBe(false);
 });
});

describe('head metadata',()=>{
 it('reads the first head title (whitespace collapsed, unicode kept) and the description meta',()=>{
  expect(htmlPageMetadata('<html><head><title>\n  Café   ☕ report </title><title>second</title><META NAME="Description" content="  Über  "></head><body></body></html>')).toEqual({title:'Café ☕ report',description:'Über'});
 });
 it('ignores body content and answers null for empty or absent fields',()=>{
  expect(htmlPageMetadata('<html><head><title>   </title><meta name="description" content=" "></head><body><title>body</title><meta name="description" content="body"></body></html>')).toEqual({title:null,description:null});
  expect(htmlPageMetadata('')).toEqual({title:null,description:null});
 });
});

describe('backend declarations',()=>{
 it('lists backend link names in source order and ignores datasets and other links',()=>{
  expect(htmlBackendNames('<link rel="stylesheet" href="a.css"><link rel="af-backend" data-af-name="orders"><link rel="af-dataset" data-af-name="sales" href="ref:abc123"><link rel="preload af-backend" data-af-name="_two">')).toEqual(['orders','_two']);
  expect(htmlBackendNames('')).toEqual([]);
 });
 it('refuses invalid, reserved and duplicate names',()=>{
  for(const name of ['','1x','__private','na-me','名前'])expect(()=>htmlBackendNames(`<link rel="af-backend" data-af-name="${name}">`)).toThrow('Invalid namespace');
  expect(()=>htmlBackendNames('<link rel="af-backend" data-af-name="db"><link rel="af-backend" data-af-name="db">')).toThrow('Duplicate');
 });
});

describe('html-source edits',()=>{
 it('parses template content separately and finds the written html, head and body',()=>{
  const document=parseSource('<!doctype html><html><head></head><body><template><p>in</p></template><p>out</p></body></html>');
  expect(document.doctypeEnd).toBe('<!doctype html>'.length);
  expect([document.html?.tagName,document.head?.tagName,document.body?.tagName]).toEqual(['html','head','body']);
  expect(document.templateElements.map(node=>node.tagName)).toEqual(['p']);
  expect(document.elements.filter(node=>node.tagName==='p')).toHaveLength(1);
 });

 it('applies edits from the end, keeping list order for edits at one offset',()=>{
  expect(applyEdits('ab',[{start:1,end:1,text:'X'},{start:1,end:1,text:'Y'}])).toBe('aXYb');
  expect(applyEdits('héllo wörld',[{start:0,end:5,text:'bye'},{start:6,end:11,text:'🌍'}])).toBe('bye 🌍');
  expect(applyEdits('same',[])).toBe('same');
 });

 it('inserts an escaped attribute after the last written one, or after the tag name',()=>{
  const p='<p id="a">x</p>';
  expect(applyEdits(p,[insertAttribute(p,element(p,'p'),'data-x','"q" & r')])).toBe('<p id="a" data-x="&quot;q&quot; &amp; r">x</p>');
  const br='<p>a<br/>b</p>';
  expect(applyEdits(br,[insertAttribute(br,element(br,'br'),'data-af-id','n1')])).toBe('<p>a<br data-af-id="n1"/>b</p>');
 });

 it('removes an element with its own line (LF and CRLF), or just the element inline',()=>{
  const list='<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>';
  expect(applyEdits(list,[removeElement(list,element(list,'li'))])).toBe('<ul>\n  <li>b</li>\n</ul>');
  const crlf='<ul>\r\n  <li>a</li>\r\n</ul>';
  expect(applyEdits(crlf,[removeElement(crlf,element(crlf,'li'))])).toBe('<ul>\r\n</ul>');
  const inline='<p>a<b>x</b>c</p>';
  expect(applyEdits(inline,[removeElement(inline,element(inline,'b'))])).toBe('<p>ac</p>');
 });

 it('places tags first in the head at its indentation, or where an implied head would be',()=>{
  const indented='<html>\n<head>\n    <title>t</title>\n</head></html>';
  expect(applyEdits(indented,[atHeadStart(parseSource(indented),['<meta charset="utf-8">','<base>'])])).toBe('<html>\n<head>\n    <meta charset="utf-8">\n    <base>\n    <title>t</title>\n</head></html>');
  const headless='<!doctype html><p>x</p>';
  expect(applyEdits(headless,[atHeadStart(parseSource(headless),['<meta charset="utf-8">'])])).toBe('<!doctype html><meta charset="utf-8"><p>x</p>');
  const bare='<html lang="en"><p>x</p></html>';
  expect(applyEdits(bare,[atHeadStart(parseSource(bare),['<a>','<b>'])])).toBe('<html lang="en"><a><b><p>x</p></html>');
 });
});
