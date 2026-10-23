import { afterEach, expect, it, vi } from 'vitest';
import { createHtmlAnnotationPainter } from '../../html-bridge/annotations';
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; document.querySelectorAll('[data-af="annotation-overlay"]').forEach((node) => node.remove()); window.getSelection()?.removeAllRanges(); });
it('paints exact text highlights without changing authored text or native selection', () => {
  document.body.innerHTML = '<p data-af-id="n1">one <b>two</b> three</p>';
  const selected = document.createRange(); selected.selectNodeContents(document.querySelector('b')!); window.getSelection()!.addRange(selected);
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(10, 20, 30, 10)] as unknown as DOMRectList);
  const painter = createHtmlAnnotationPainter(document);
  const positions = painter.paint({ pins: [{ id: 'c1', path: 'n1', anchor: { kind: 'html-node', v: 1, revision: '1', nodeId: 'n1', quote: 'two' } }], mode: 'on', openId: 'c1', hoverId: null });
  expect(positions[0]?.status).toBe('exact');
  expect(document.querySelector('[data-af="annotation-overlay"]')?.children.length).toBe(1);
  expect(document.querySelector('p')!.innerHTML).toBe('one <b>two</b> three');
  expect(window.getSelection()!.toString()).toBe('two');
  painter.dispose(); expect(document.querySelector('[data-af="annotation-overlay"]')).toBeNull();
});
it('does not retarget missing or ambiguous anchors to another node', () => {
  document.body.innerHTML = '<p data-af-id="n1">quote quote</p><p data-af-id="n2">quote</p>';
  const painter = createHtmlAnnotationPainter(document);
  const pins = ['n1', 'removed'].map((nodeId) => ({ id: nodeId, path: nodeId, anchor: { kind: 'html-node' as const, v: 1 as const, revision: '1', nodeId, quote: 'quote' } }));
  expect(painter.paint({ pins, mode: 'on', openId: null, hoverId: null }).map((item) => item.status)).toEqual(['ambiguous', 'missing']);
  expect(document.querySelector('[data-af="annotation-overlay"]')?.children.length).toBe(0);
  painter.dispose();
});
it('keeps area comments relative to their stable node after layout changes', () => {
  document.body.innerHTML = '<section data-af-id="n1">area</section>';
  vi.spyOn(document.querySelector('section')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 200, 100));
  const painter = createHtmlAnnotationPainter(document);
  const positions = painter.paint({ pins: [{ id: 'c1', path: 'n1', anchor: { kind: 'html-node', v: 1, revision: '1', nodeId: 'n1', quote: '' }, range: { v: 1, kind: 'area', box: { x: .1, y: .2, w: .5, h: .4 } } }], mode: 'on', openId: null, hoverId: null });
  expect(positions[0]?.rect).toEqual({ x: 120, y: 220, width: 100, height: 40 });
  expect((document.querySelector('[data-af="annotation-overlay"]')!.firstElementChild as HTMLElement).style.width).toBe('100px');
  painter.dispose();
});
it('resolves a dynamic ID only inside its persisted ancestor and never follows it elsewhere',()=>{
 document.body.innerHTML='<ul data-af-id="tasks"><li data-af-id="task:123">Finish review</li></ul><aside><p data-af-id="task:123">Finish review</p></aside>';
 const painter=createHtmlAnnotationPainter(document);
 const input={pins:[{id:'dynamic',path:'task:123',anchor:{kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'task:123',ancestorId:'tasks',quote:''}}],mode:'on' as const,openId:null,hoverId:null};
 expect(painter.paint(input)[0]?.status).toBe('exact');
 document.querySelector('li')!.remove();
 expect(painter.paint(input)[0]?.status).toBe('missing');
 expect(document.querySelector('[data-af="annotation-overlay"]')?.children.length).toBe(0);
 document.querySelector('ul')!.innerHTML='<li data-af-id="task:123"></li><li data-af-id="task:123"></li>';
 expect(painter.paint(input)[0]?.status).toBe('ambiguous');
 painter.dispose();
});
