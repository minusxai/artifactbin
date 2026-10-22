import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'parse5';
import {compiledStylesheetMarkup} from '../src/migration/conversion/compiled/css-payload.ts';
test('compiler stylesheet string literals cannot terminate the HTML style block',()=>{
 const css='a::before{content:"</StYlE><script>unexpected()</script>"}';
 const html=compiledStylesheetMarkup(css);
 const document=parse('<!doctype html><html><head>'+html+'</head><body></body></html>') as any;
 const root=document.childNodes.find((n:any)=>n.tagName==='html');
 const head=root.childNodes.find((n:any)=>n.tagName==='head');
 assert.deepEqual(head.childNodes.map((n:any)=>n.tagName),['style']);
 assert.equal(head.childNodes[0].childNodes[0].value,css.replace('</StYlE','<\\/StYlE'));
 assert.equal(root.childNodes.find((n:any)=>n.tagName==='body').childNodes.length,0);
});
