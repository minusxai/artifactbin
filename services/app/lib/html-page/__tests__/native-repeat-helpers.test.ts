import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import {canonicalizeHtmlPage} from '../index';

/** Publication must identify structural nodes too. Conversion plans therefore
 * include helper anchors in every owning repeat, including lazy conditions and
 * custom table cells. The template element itself is not cloned into a row. */
describe('canonical native repeat helper composition',()=>{
 const sourceButton='source-choice',helpers=['helper-trigger','helper-contents'];
 const source=(identified:boolean)=>`<!doctype html><html><head><script src="/af/core.js"></script></head><body><div data-af-id="repeat"></div><template id="row"><span data-af-id="condition"></span></template><template id="condition-body"><span${identified?' data-af-id="helper-trigger"':''} class="inline-flex"><span${identified?' data-af-id="helper-contents"':''} style="display:contents"><button data-af-id="source-choice" type="button" disabled aria-label="Choose">Choose</button></span></span></template></body></html>`;
 function clone(html:string,templateId:string,planned:readonly string[],row:string){
  const document=new JSDOM(html).window.document,template=document.getElementById(templateId) as HTMLTemplateElement;
  const fragment=template.content.cloneNode(true) as DocumentFragment;
  for(const node of fragment.querySelectorAll('[data-af-id]')){
   const id=node.getAttribute('data-af-id')!;
   if(!planned.includes(id))throw Error('Unplanned repeated identity');
   node.setAttribute('data-af-id',`instance-${row}-${id}`);
  }
  return fragment;
 }
 it('exposes the identityless helper regression after actual canonical publication',()=>{
  const saved=canonicalizeHtmlPage(source(false),{previousHtml:source(false)});
  expect(()=>clone(saved.html,'condition-body',[sourceButton],'one')).toThrow('Unplanned repeated identity');
 });
 it('preserves all source and helper identities through canonical replay and distinct lazy row clones',()=>{
  const saved=canonicalizeHtmlPage(source(true),{previousHtml:source(true)});
  const replay=canonicalizeHtmlPage(saved.html,{previousHtml:saved.html,ledger:saved.ledger});expect(replay.html).toBe(saved.html);expect(replay.ledger).toEqual(saved.ledger);expect([...replay.nodeIds].sort()).toEqual([...saved.nodeIds].sort());
  const planned=['condition',sourceButton,...helpers];
  const row=clone(saved.html,'row',planned,'one');expect(row.querySelector('[data-af-id]')?.getAttribute('data-af-id')).toBe('instance-one-condition');
  const first=clone(saved.html,'condition-body',planned,'one'),second=clone(saved.html,'condition-body',planned,'two');
  expect([...first.querySelectorAll('[data-af-id]')].map(node=>node.getAttribute('data-af-id'))).toEqual(helpers.concat(sourceButton).map(id=>`instance-one-${id}`));
  expect(second.querySelector('button')?.getAttribute('data-af-id')).toBe('instance-two-source-choice');
  expect(first.querySelector('button')?.disabled).toBe(true);expect(first.querySelector('button')?.type).toBe('button');expect(first.querySelector('button')?.getAttribute('aria-label')).toBe('Choose');
  expect(()=>clone(saved.html,'condition-body',planned.filter(id=>id!==helpers[1]),'three')).toThrow('Unplanned repeated identity');
 });
});
