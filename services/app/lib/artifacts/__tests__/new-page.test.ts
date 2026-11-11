import {expect,it} from 'vitest';
import {normalizeNewHtmlPage} from '../new-page';
import {editableRegions} from '../../live-regions';

it('normalizes authored and imported rich pages to native after assigning identities',()=>{
 for(const html of ['<article data-af-editable="rich"><p>Hello</p></article>','<article data-af-id="region" data-af-editable="rich"><p data-af-id="paragraph">Imported</p></article>']){
  const page=normalizeNewHtmlPage(html);
  expect(editableRegions(page.html)).toEqual([expect.objectContaining({kind:'rich-native-v1'})]);
  expect(page.html).not.toContain('data-af-editable="rich"');
  expect(normalizeNewHtmlPage(page.html).html).toBe(page.html);
 }
});
it('preserves an already native page and refuses unsupported legacy input instead of publishing rich',()=>{
 const native=normalizeNewHtmlPage('<article data-af-id="region" data-af-editable="rich-native-v1"><p data-af-id="paragraph">Native</p></article>');
 expect(normalizeNewHtmlPage(native.html).html).toBe(native.html);
 expect(()=>normalizeNewHtmlPage('<article data-af-editable="rich"><table><tr><td>Unsupported</td></tr></table></article>')).toThrow();
 expect(()=>normalizeNewHtmlPage('<h1 data-af-editable="text">Legacy title</h1>')).toThrow();
});
it('keeps supplied inline anchors on identified imports during ID allocation',()=>{
 const inner='<p data-af-id="paragraph"><strong data-af-id="mark">Anchor</strong></p>';
 const imported=normalizeNewHtmlPage(`<article data-af-id="region" data-af-editable="rich">${inner}</article>`);
 expect(imported.html).toContain(inner);
 expect(normalizeNewHtmlPage(`<article data-af-editable="rich">${inner}</article>`).html).toContain(inner);
});
