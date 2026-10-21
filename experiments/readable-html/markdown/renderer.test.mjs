import {test} from 'node:test';
import assert from 'node:assert/strict';
import {render,encode,decode} from './renderer.mjs';
test('JSON source is lossless and HTML script safe',()=>{
 for(const value of ['', '\n# Heading\n', '\t indented  \r\nnext', '<pre>&amp;</pre></script><!--', 'café 😀 "\\']) {
  const encoded=encode(value);assert.equal(encoded.includes('<'),false);assert.equal(decode(encoded),value);
 }
 for(const value of ['{}','null','42','[]','broken'])assert.throws(()=>decode(value));
});
test('CommonMark semantics, explicit no GFM and no heading IDs',()=>{
 assert.equal(render('# Heading\n\n**bold** and *em*\n\n- a\n- b\n'),'<h1>Heading</h1>\n<p><strong>bold</strong> and <em>em</em></p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n');
 assert.match(render('a  \nb'),/<br/);assert.match(render('    code'),/<pre><code>code/);
 assert.match(render('```html\n<b>x</b>\n```'),/&lt;b&gt;x&lt;\/b&gt;/);
 assert.doesNotMatch(render('| a | b |\n|---|---|\n| 1 | 2 |'),/<table/);
 assert.match(render('~~no~~'),/~~no~~/);
});
test('raw HTML and active protocols never become active markup; images cannot fetch',()=>{
 const html=render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert%281%29)\n\n[x](JaVaScRiPt:foo)\n\n[x](data:text/html,foo)\n\n![alt](https://example.invalid/pixel)');
 assert.doesNotMatch(html,/<script|<img|href="(?:javascript|data):/i);
 assert.match(html,/alt/);assert.match(render('[safe](https://example.invalid/)'),/href="https:/);
});

test('a multiline unclosed reference title cannot monopolize the renderer', async()=>{
 // Run the upstream advisory's 400 KB input in a disposable child so a
 // quadratic regression is bounded even though render() is synchronous.
 const {spawnSync}=await import('node:child_process');
 const renderer=new URL('./renderer.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import {render} from ${JSON.stringify(renderer)};
  const output=render('[a]: /u "'+'x\\n'.repeat(200000));
  if(!output.startsWith('<p>')||!output.includes('[a]: /u'))process.exit(1);
  console.log('rendered');
 `],{encoding:'utf8',timeout:5000,maxBuffer:1024});
 assert.ifError(child.error);
 assert.equal(child.status,0,child.stderr);
 assert.equal(child.stdout.trim(),'rendered');
});
