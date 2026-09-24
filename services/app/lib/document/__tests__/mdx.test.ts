import {describe, expect, it} from 'vitest';
import {parseDocumentMdx, serializeDocumentMdx, documentJsx} from '../mdx';
import {assertDocument} from '../model';

describe('MDX as document data',()=>{
 it('uses native Markdown prose and preserves marks, lists and tables',()=>{
  const d=parseDocumentMdx('# Heading\n\nHello **bold** and *emphasis*.\n\n- First\n- Second\n\n| A | B |\n| - | - |\n| x | y |');
  assertDocument(d);expect(Object.values(d.nodes).map(n=>n.type)).toEqual(expect.arrayContaining(['heading','paragraph','list','listItem','table','tableRow','tableCell']));
  expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);
 });
 it('round-trips nested layouts, range fonts, dimensions and floats',()=>{
  const d=parseDocumentMdx('<Flex direction="row" sizes={[2,1]}>\n\nHello <span className="font-mono">world</span>.\n\n<img src="https://example.com/image.png" width={240} float="right" />\n\n</Flex>');
  expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);
  expect(documentJsx(d)).toContain('font-mono');
 });
 it('retains edited paragraph classes and IDs through export',()=>{
  const d=parseDocumentMdx('Text.');const paragraph=Object.values(d.nodes).find(n=>n.type==='paragraph')!;paragraph.props.className='font-serif';
  const mdx=serializeDocumentMdx(d);expect(mdx).not.toContain('<p');expect(parseDocumentMdx(mdx)).toEqual(d);
 });
 it('keeps managed iframe source separate from generated runtime markup',()=>{
  const d=parseDocumentMdx('<Iframe title="Demo"><div>Hello</div><script>{`document.body.dataset.ready = "yes";`}</script></Iframe>');
  expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);expect(documentJsx(d)).not.toContain('srcdoc');
 });
 it.each(['export const x = 1','import X from "x"','{fetch("https://example.com")}','<div onClick={() => alert(1)}>x</div>','<a href="javascript:alert(1)">x</a>','<iframe src="https://example.com" />'])('rejects executable or unsafe source: %s',source=>{
  expect(()=>parseDocumentMdx(source)).toThrow();
 });
 it('round-trips code and literal punctuation without evaluating it',()=>{
  const d=parseDocumentMdx('```js\nconst x = "<>&{}";\n```\n\nA & B.');expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);
 });
});
