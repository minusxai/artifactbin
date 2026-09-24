import {describe, expect, it} from 'vitest';
import {parseDocumentMdx, serializeDocumentMdx, documentJsx, reparseDocumentMdx} from '../mdx';
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
it('supports ordinary component text',()=>{
 const d=parseDocumentMdx('<Card>Simple **card** text.</Card>');
 expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);
});
it('reuses the current declaration and embed validation boundary',()=>{
 const d=parseDocumentMdx('<Helmet><Value name="total" type="number" default={42} /><Query name="totals">{`select $total as value`}</Query></Helmet>\n\nTotal: {$total}\n\n<Number data="$totals" col="value" agg="sum" />');
 expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);
 expect(()=>parseDocumentMdx('<Helmet><Value name="total" type="number" default="wrong" /></Helmet>')).toThrow();
});

it('keeps prose styling and identities when editing source or inserting a paragraph',()=>{
 const before=parseDocumentMdx('# Title\n\nFirst paragraph\n\nLast paragraph');
 const ids=before.nodes[before.rootId].children!;before.nodes[ids[2]].props.className='font-serif';
 expect(reparseDocumentMdx(before,serializeDocumentMdx(before,false))).toEqual(before);
 const next=reparseDocumentMdx(before,'## Title\n\nFirst paragraph\n\nInserted paragraph\n\nLast paragraph');
 expect(next.rootId).toBe(before.rootId);expect(next.nodes[ids[0]].props.depth).toBe(2);
 expect(next.nodes[ids[2]].props.className).toBe('font-serif');
 expect(next.nodes[next.rootId].children?.at(-1)).toBe(ids[2]);
});
it('gives an empty source an editable paragraph',()=>{
 const d=parseDocumentMdx('');expect(d.nodes[d.rootId].children).toHaveLength(1);
});
it('renders document measure and block dimensions in the shared artifact runtime',()=>{
 const d=parseDocumentMdx('<div width={320} height={180} float="left" className="p-6">\n\nText\n\n</div>');
 const source=documentJsx(d);
 expect(source).toContain('max-w-[1000px]');expect(source).toContain('w-[320px]');expect(source).toContain('min-h-[180px]');expect(source).toContain('float-left');
});
it('exports whole-paragraph styling as a div, without a second annotation syntax',()=>{
 const d=parseDocumentMdx('Text');d.nodes[d.nodes[d.rootId].children![0]].props.className='font-serif';
 const source=serializeDocumentMdx(d,false);expect(source).toContain('<div className="font-serif">');
 const parsed=parseDocumentMdx(source);expect(parsed.nodes[parsed.nodes[parsed.rootId].children![0]]).toMatchObject({type:'paragraph',props:{className:'font-serif'}});
 expect(parseDocumentMdx(serializeDocumentMdx(d))).toEqual(d);
});
