/** Native link HTML is lossless across the strict persistence boundary, with unchanged URL admission. */
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { createRegionState, openRegionDoc, regionHtml, validateRegionUpdate } from '..';
const kind='rich-native-v1' as const;
it.each(['https://example.com/qa','http://example.com/','mailto:test@example.com','/relative?q=1#part','#section'])(
 'roundtrips allowed link %s with its target, security relation, title and identity',href=>{
  const html=`<p data-af-id="af-1"><a data-af-id="af-2" href="${href}" target="_blank" rel="noopener noreferrer nofollow" title="A &amp; B">linked</a></p>`;
  const state=createRegionState(kind,html).state;
  expect(regionHtml(kind,state)).toBe(html);
  expect(regionHtml(kind,createRegionState(kind,regionHtml(kind,state)).state)).toBe(html);
 });
it('retains an explicitly empty link title through persistence',()=>{
 const html='<p><a href="/relative" title="">linked</a></p>';
 expect(regionHtml(kind,createRegionState(kind,html).state)).toBe(html);
});
it('keeps authored same-window links without inventing target or relation attributes',()=>{
 const html='<p><a href="/relative">linked</a></p>';
 expect(regionHtml(kind,createRegionState(kind,html).state)).toBe(html);
});
it.each(['javascript:alert(1)','java\tscript:alert(1)','data:text/html,x','vbscript:x'])(
 'refuses forged unsafe link %j at the native update boundary without changing the base state',href=>{
  const initial=createRegionState(kind,'<p data-af-id="af-1">safe</p>');
  const client=openRegionDoc(initial.state,{kind,clientId:987});const before=Y.encodeStateVector(client);
  const text=(client.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.format(0,4,{link:{href,target:'_blank',rel:'noopener noreferrer nofollow',class:null,afId:null}});
  expect(()=>validateRegionUpdate(kind,initial.state,Y.encodeStateAsUpdate(client,before),987)).toThrow();
  expect(regionHtml(kind,initial.state)).toBe('<p data-af-id="af-1">safe</p>');client.destroy();
 });
it.each([{target:'named-frame'},{rel:'opener'},{class:'executable'},{onclick:'alert(1)'}])(
 'still refuses unsupported native link attributes %j',extra=>{
  const initial=createRegionState(kind,'<p>safe</p>');
  const client=openRegionDoc(initial.state,{kind,clientId:987});const before=Y.encodeStateVector(client);
  const text=(client.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.format(0,4,{link:{href:'https://example.com',...extra}});
  expect(()=>validateRegionUpdate(kind,initial.state,Y.encodeStateAsUpdate(client,before),987)).toThrow();client.destroy();
 });
