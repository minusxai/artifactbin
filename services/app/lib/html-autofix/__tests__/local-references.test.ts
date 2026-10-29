/** localReferences: the relative project files a page loads, which the preview, publish and missing-asset rule resolve. */
import {expect,it} from 'vitest';
import {localReferences} from '../index';
import {parseSource} from '../../html-page/html-source';

const paths=(html:string)=>{const document=parseSource(html);return localReferences(document.elements,document.templateElements).map(ref=>ref.path);};

it('collects element sources, posters, object data, link and svg hrefs, srcset candidates and template content',()=>{
 expect(paths(`<link rel="stylesheet" href="./css/site.css"><img src="img/a.png" srcset="img/a-1x.png 1x, img/a-2x.png 2x"><video src="v.mp4" poster="poster.jpg"></video>
<object data="doc.pdf"></object><svg><image href="sprite.svg"></image><use href="#local"></use></svg>
<template><img src="later.png"></template>`)).toEqual(['css/site.css','img/a.png','img/a-1x.png','img/a-2x.png','v.mp4','poster.jpg','doc.pdf','sprite.svg','later.png']);
});

// BUG: the svg `xlink:href` branch never matches. parse5 stores a foreign `xlink:href` as prefix `xlink` and name
// `href`, and html-source `attribute` refuses prefixed names, so a sprite `<use xlink:href="icons.svg#home">` is not a
// local reference: preview never serves it and the missing-asset rule never flags it. Reported, not fixed.
it.fails('collects an svg xlink:href sprite reference',()=>{
 expect(paths('<svg><use xlink:href="icons.svg#home"></use></svg>')).toEqual(['icons.svg']);
});

it('normalizes dot segments, strips query and hash, and decodes percent escapes and unicode names',()=>{
 expect(paths('<img src="./a/../b/./c.png?v=1#x"><img src="caf%C3%A9.png"><img src="naïve 名.png"><img src="100%.png"><img src="../../outside.png">')).toEqual(['b/c.png','café.png','naïve 名.png','100%.png','outside.png']);
});

it('skips remote, absolute, fragment, template-expression, empty and dataset references',()=>{
 expect(paths('<img src="https://x.test/a.png"><img src="//cdn/a.png"><img src="/abs.png"><img src="data:image/png;base64,AA"><img src="#x"><img src="${dynamic}"><img src="{{x}}"><img src="   "><img src="./"><link rel="af-dataset" href="ref:abc123">')).toEqual([]);
 expect(paths('')).toEqual([]);
});

it('reads literal relative imports from inline module scripts only, and nothing from unparseable code',()=>{
 expect(paths('<script type="module">import a from "./a.js";import("./lazy.js");import b from "@afbin/vega";</script><script>import x from "./classic.js"</script><script type="module">import {</script>')).toEqual(['a.js','lazy.js']);
});

it('keeps the element and the value as written beside the resolved path',()=>{
 const document=parseSource('<img src=" ./pic.png?w=2 ">');
 const [ref]=localReferences(document.elements);
 expect(ref).toMatchObject({value:'./pic.png?w=2',path:'pic.png'});
 expect(ref!.element.tagName).toBe('img');
});
