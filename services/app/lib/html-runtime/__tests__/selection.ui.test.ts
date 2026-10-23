import { afterEach, expect, it } from 'vitest';
import { htmlSelection } from '../../html-bridge/selection';
afterEach(() => { document.body.innerHTML = ''; window.getSelection()?.removeAllRanges(); });
it('anchors native text selection to persistent HTML identity with an explicit version', () => {
  document.body.innerHTML = '<main data-af-id="n1"><p data-af-id="n2">hello <strong>world</strong></p></main>';
  const text = document.querySelector('strong')!.firstChild!;
  const range = document.createRange(); range.selectNodeContents(text);
  window.getSelection()!.addRange(range);
  const selection = htmlSelection(window, undefined, '12');
  expect(selection?.anchor).toMatchObject({ kind: 'html-node', v: 1, revision: '12', nodeId: 'n2', quote: 'world' });
  expect(selection?.ancestors).toEqual([{ path: 'n1', tag: 'main', hint: '' }]);
  document.querySelector('main')!.prepend(document.createElement('aside'));
  expect(htmlSelection(window, undefined, '12')?.anchor.nodeId).toBe('n2');
});
it('does not invent an AST or HTML identity for unaddressed nodes', () => {
  document.body.innerHTML = '<p>no identity</p>';
  expect(htmlSelection(window, document.querySelector('p'), '12')).toBeNull();
});
it('captures data-derived identities relative to a saved ancestor before persistence',()=>{
 document.body.innerHTML='<ul data-af-id="tasks"></ul>';
 const savedIds=['tasks'];
 document.querySelector('ul')!.innerHTML='<li data-af-id="task:123">Finish review</li>';
 const item=document.querySelector('li')!;
 const range=document.createRange();range.selectNodeContents(item);window.getSelection()!.addRange(range);
 expect(htmlSelection(window,undefined,'7',savedIds)?.anchor).toMatchObject({nodeId:'task:123',ancestorId:'tasks',quote:'Finish review',revision:'7'});
});
