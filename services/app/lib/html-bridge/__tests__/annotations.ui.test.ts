import {htmlTextFingerprint} from '@artifactbin/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createHtmlAnnotationPainter } from '../annotations';
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; document.querySelectorAll('[data-af="annotation-overlay"]').forEach((node) => node.remove()); window.getSelection()?.removeAllRanges(); });
it('paints migrated block context as an original node outline, including changed or repeated words',()=>{
 document.body.innerHTML='<section data-af-id="block">context context</section>';
 const node=document.querySelector('section')!;vi.spyOn(node,'getBoundingClientRect').mockReturnValue(new DOMRect(10,20,200,80));
 const painter=createHtmlAnnotationPainter(document),anchor={kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'block',quote:'context',presentation:'block' as const};
 const input={pins:[{id:'block-thread',path:'block',anchor}],mode:'on' as const,openId:null,hoverId:null};
 expect(painter.paint(input)[0]).toEqual({id:'block-thread',status:'exact',rect:{x:10,y:20,width:200,height:80}});
 const mark=()=>document.querySelector('[data-af="annotation-overlay"] div') as HTMLElement;
 expect(mark().style.outline).toBe('1px solid rgba(245, 158, 11, .15)');expect(mark().style.outlineOffset).toBe('3px');expect(mark().style.background).toBe('transparent');
 node.textContent='edited context';expect(painter.paint(input)[0]?.status).toBe('exact');
 painter.paint({...input,openId:'block-thread'});expect(mark().style.outline).toBe('1px solid rgba(245, 158, 11, 0.85)');expect(mark().style.boxShadow).toContain('rgba(245, 158, 11, .08)');
 painter.paint({...input,mode:'off'});expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(0);
 expect(node.outerHTML).toBe('<section data-af-id="block">edited context</section>');painter.dispose();
});
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
it('keeps resolved history geometry without painting until explicitly inspected',()=>{
 document.body.innerHTML='<p data-af-id="n1">Resolved words</p>';
 const painter=createHtmlAnnotationPainter(document),pin={id:'resolved',path:'n1',anchor:{kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'n1',quote:''},layoutOnly:true};
 const input={pins:[pin],mode:'on' as const,openId:pin.id,hoverId:pin.id};
 expect(painter.paint(input)[0]?.status).toBe('exact');expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(0);
 painter.paint({...input,pins:[{...pin,layoutOnly:false}]});expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(1);painter.dispose();
});

import { revealHtmlAnnotation } from '../annotations';
it('reveals only a unique scoped target and leaves stale anchors missing', () => {
 document.body.innerHTML='<section data-af-id="scope"><p data-af-id="target">inside</p></section><p data-af-id="target">outside</p>';
 const inside=document.querySelector('section p')!,outside=document.querySelector('body > p')!;
 const reveal=vi.fn();Object.defineProperty(inside,'scrollIntoView',{value:reveal});Object.defineProperty(outside,'scrollIntoView',{value:vi.fn()});
 const pin={id:'thread',path:'target',anchor:{kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'target',ancestorId:'scope',quote:''}};
 revealHtmlAnnotation(document,pin);expect(reveal).toHaveBeenCalledOnce();
 inside.remove();revealHtmlAnnotation(document,pin);expect(outside.scrollIntoView).not.toHaveBeenCalled();
});
it('restores all exact migrated nested and sibling parts, while stale or duplicate identities paint nothing', async () => {
 const {htmlTextFingerprint}=await import('@artifactbin/contracts');
 document.body.innerHTML='<p data-af-id="p">one <b data-af-id="b">two</b> end</p><p data-af-id="next">next words</p>';
 vi.spyOn(Range.prototype,'getClientRects').mockReturnValue([new DOMRect(10,20,30,10)] as unknown as DOMRectList);
 const part=(nodeId:string,quote:string,start:number,end:number)=>{const text=document.querySelector(`[data-af-id="${nodeId}"]`)!.textContent!;return {nodeId,quote,range:{start,end,length:text.length,fingerprint:htmlTextFingerprint(text)}};};
 const segments=[part('p','one ',0,4),part('b','two',0,3),part('next','next',0,4)];
 const anchor={kind:'html-node' as const,v:1 as const,revision:'3',nodeId:'p',quote:'one two next',segments};
 const painter=createHtmlAnnotationPainter(document), paint=()=>painter.paint({pins:[{id:'root',path:'p',anchor}],mode:'on',openId:null,hoverId:null});
 expect(paint()[0]?.status).toBe('exact');expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(3);
 document.querySelector('b')!.textContent='changed';expect(paint()[0]?.status).toBe('missing');expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(0);
 document.querySelector('b')!.textContent='two';document.body.insertAdjacentHTML('beforeend','<p data-af-id="next">next words</p>');expect(paint()[0]?.status).toBe('ambiguous');expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(0);
 painter.dispose();
});
it('keeps stale migrated selection root geometry without painting any surviving fragment',()=>{
 document.body.innerHTML='<p data-af-id="root">retained node</p>';const painter=createHtmlAnnotationPainter(document);
 const positions=painter.paint({pins:[{id:'old',path:'root',anchor:{kind:'html-node',v:1,revision:'3',nodeId:'root',quote:'old selection',segments:[]}}],mode:'on',openId:null,hoverId:null});
 expect(positions[0]?.status).toBe('exact');expect(document.querySelector('[data-af="annotation-overlay"]')!.children.length).toBe(0);painter.dispose();
});
it('paints migrated ranges behind text with the original comment palette and cleans registrations',async()=>{
 const {htmlTextFingerprint}=await import('@artifactbin/contracts');document.body.innerHTML='<p data-af-id="root">selected</p>';
 const registry=new Map<string,unknown>(),Highlight=vi.fn(function(...ranges:Range[]){return {ranges};});
 vi.stubGlobal('CSS',{highlights:registry});vi.stubGlobal('Highlight',Highlight);
 try{const painter=createHtmlAnnotationPainter(document),anchor={kind:'html-node' as const,v:1 as const,revision:'3',nodeId:'root',quote:'selected',segments:[{nodeId:'root',quote:'selected',range:{start:0,end:8,length:8,fingerprint:htmlTextFingerprint('selected')}}]};
 painter.paint({pins:[{id:'thread',path:'root',anchor}],mode:'on',openId:null,hoverId:null});expect(registry.size).toBe(1);expect(Highlight).toHaveBeenCalledTimes(1);expect(document.querySelector('[data-af="annotation-overlay"] style')!.textContent).toContain('rgba(245, 158, 11, 0.1)');expect(document.querySelector('[data-af="annotation-overlay"] div')).toBeNull();
 painter.paint({pins:[],mode:'off',openId:null,hoverId:null});expect(registry.size).toBe(0);painter.dispose();
 }finally{vi.unstubAllGlobals();}
});

it('positions migrated comments from the original forward inline endpoint',()=>{
 document.body.innerHTML='<p data-af-id="p"><af-text>Keep </af-text><strong><af-text>bold</af-text></strong> tail</p>';
 const node=document.querySelector('p')!,text=node.textContent!,next=node.querySelector('strong af-text')!.firstChild;
 vi.spyOn(Range.prototype,'getBoundingClientRect').mockImplementation(function(this:Range){return new DOMRect(10,this.endContainer===next?19:20,80,40);});
 vi.spyOn(Range.prototype,'getClientRects').mockReturnValue([] as unknown as DOMRectList);
 const painter=createHtmlAnnotationPainter(document),anchor={kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'p',quote:'Keep ',segments:[{nodeId:'p',quote:'Keep ',endAffinity:'forward' as const,range:{start:0,end:5,length:text.length,fingerprint:htmlTextFingerprint(text)}}]};
 const positions=painter.paint({pins:[{id:'comment',path:'p',anchor}],mode:'on',openId:null,hoverId:null});
 expect(positions[0]).toMatchObject({status:'exact',rect:{x:10,y:19,width:80,height:40}});painter.dispose();
});

it('shares a block outline by node while preserving thread positions and mixed text highlights',()=>{
 document.body.innerHTML='<section data-af-id="a">context</section><section data-af-id="b">other</section>';
 for(const [i,node]of [...document.querySelectorAll('section')].entries())vi.spyOn(node,'getBoundingClientRect').mockReturnValue(new DOMRect(i*100,20,80,40));
 vi.spyOn(Range.prototype,'getClientRects').mockReturnValue([new DOMRect(0,20,20,10)] as unknown as DOMRectList);
 const block=(id:string,nodeId:string)=>({id,path:nodeId,anchor:{kind:'html-node' as const,v:1 as const,revision:'1',nodeId,quote:'',presentation:'block' as const}});
 const painter=createHtmlAnnotationPainter(document),pins=[block('one','a'),block('two','a'),block('three','b')],input={pins,mode:'on' as const,openId:null,hoverId:null};
 const positions=painter.paint(input);expect(positions.map(p=>p.id)).toEqual(['one','two','three']);expect(positions[0]?.rect).toEqual(positions[1]?.rect);
 const marks=()=>[...document.querySelectorAll('[data-af="annotation-overlay"] div')] as HTMLElement[];
 expect(marks()).toHaveLength(2);
 painter.paint({...input,openId:'two'});expect(marks()).toHaveLength(2);expect(marks()[0]?.style.outline).toBe('1px solid rgba(245, 158, 11, 0.85)');
 painter.paint({...input,pins:[pins[0]!,{id:'text',path:'a',anchor:{kind:'html-node',v:1,revision:'1',nodeId:'a',quote:'context'}}]});expect(marks()).toHaveLength(2);
 painter.paint({...input,pins:[pins[1]!]});expect(marks()).toHaveLength(1);expect(marks()[0]?.style.outline).toBe('1px solid rgba(245, 158, 11, .15)');
 document.querySelector('[data-af-id="a"]')!.remove();expect(painter.paint({...input,pins:[pins[0]!]})[0]?.status).toBe('missing');expect(marks()).toHaveLength(0);painter.dispose();
});

it('paints imported outlines in document coordinates through scroll and reflow without changing viewport reports or authored DOM',()=>{
 document.body.innerHTML='<p data-af-id="p">source context</p>';const node=document.querySelector('p')!,original=node.outerHTML;
 const rect=vi.spyOn(node,'getBoundingClientRect').mockReturnValue(new DOMRect(408,248,672,152.953125));
 vi.spyOn(window,'scrollX','get').mockReturnValue(0);const scroll=vi.spyOn(window,'scrollY','get').mockReturnValue(0);
 const painter=createHtmlAnnotationPainter(document,{coordinateSpace:'document'}),input={pins:[{id:'one',path:'p',anchor:{kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'p',quote:'context',presentation:'block' as const}}],mode:'on' as const,openId:null,hoverId:null};
 const mark=()=>document.querySelector('[data-af="annotation-overlay"]>div') as HTMLElement;
 expect(painter.paint(input)[0]?.rect.y).toBe(248);expect((mark().parentElement as HTMLElement).style.position).toBe('absolute');expect(mark().style.position).toBe('absolute');expect(mark().style.top).toBe('248px');
 scroll.mockReturnValue(100);rect.mockReturnValue(new DOMRect(408,148,672,152.953125));expect(painter.paint(input)[0]?.rect.y).toBe(148);expect(mark().style.top).toBe('248px');
 rect.mockReturnValue(new DOMRect(20,160,350,200));expect(painter.paint(input)[0]?.rect).toEqual({x:20,y:160,width:350,height:200});expect(mark().style.top).toBe('260px');expect(mark().style.width).toBe('350px');
 expect(node.outerHTML).toBe(original);painter.paint({...input,mode:'off'});expect(document.querySelector('[data-af="annotation-overlay"]')!.children).toHaveLength(0);painter.dispose();expect(document.querySelector('[data-af="annotation-overlay"]')).toBeNull();
});
it('keeps ordinary native annotation overlays viewport-relative while scrolled',()=>{
 document.body.innerHTML='<p data-af-id="p">context</p>';vi.spyOn(document.querySelector('p')!,'getBoundingClientRect').mockReturnValue(new DOMRect(10,20,80,40));vi.spyOn(window,'scrollY','get').mockReturnValue(100);
 const painter=createHtmlAnnotationPainter(document);painter.paint({pins:[{id:'one',path:'p',anchor:{kind:'html-node',v:1,revision:'1',nodeId:'p',quote:'',presentation:'block'}}],mode:'on',openId:null,hoverId:null});const mark=document.querySelector('[data-af="annotation-overlay"]>div') as HTMLElement;expect(mark.style.position).toBe('fixed');expect(mark.style.top).toBe('20px');expect((mark.parentElement as HTMLElement).style.position).toBe('fixed');painter.dispose();
});

it('paints imported block outlines on source nodes with reversible reserved stamps and untouched authored inline priorities',()=>{
 document.body.innerHTML='<p data-af-id="p" data-af-comment-block="authored" style="outline:2px dotted red!important;outline-offset:7px!important;box-shadow:1px 2px blue!important">context</p>';
 const node=document.querySelector('p')!,original=node.outerHTML;vi.spyOn(node,'getBoundingClientRect').mockReturnValue(new DOMRect(10,20,200,80));
 const painter=createHtmlAnnotationPainter(document,{blockPresentation:'source-node'}),anchor={kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'p',quote:'context',presentation:'block' as const},pins=[{id:'one',path:'p',anchor},{id:'two',path:'p',anchor}],input={pins,mode:'on' as const,openId:null,hoverId:null};
 expect(painter.paint(input).map(p=>p.rect)).toEqual([{x:10,y:20,width:200,height:80},{x:10,y:20,width:200,height:80}]);
 expect(node.getAttribute('data-af-comment-block')).toBe('af-block-0-base');expect(document.querySelectorAll('[data-af="annotation-overlay"]>div')).toHaveLength(0);
 expect(node.getAttribute('style')).toContain('outline:2px dotted red!important');expect((node as HTMLElement).style.getPropertyPriority('outline')).toBe('important');expect((node as HTMLElement).style.getPropertyPriority('outline-offset')).toBe('important');expect((node as HTMLElement).style.getPropertyPriority('box-shadow')).toBe('important');
 painter.paint({...input,openId:'two'});expect(node.getAttribute('data-af-comment-block')).toBe('af-block-0-active');
 painter.paint({...input,pins:[pins[0]!]});expect(node.getAttribute('data-af-comment-block')).toBe('af-block-0-base');
 node.remove();expect(painter.paint(input).every(p=>p.status==='missing')).toBe(true);expect(node.outerHTML).toBe(original);
 document.body.append(node);painter.paint(input);expect(node.getAttribute('data-af-comment-block')).toBe('af-block-0-base');
 painter.paint({...input,mode:'off'});expect(node.outerHTML).toBe(original);painter.paint(input);painter.dispose();expect(node.outerHTML).toBe(original);
});
it('source node stamps do not mutate authored inline styles and clean up absent stamps',()=>{
 document.body.innerHTML='<p data-af-id="p">context</p>';const node=document.querySelector('p')!,original=node.outerHTML;vi.spyOn(node,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,80,20));
 const painter=createHtmlAnnotationPainter(document,{blockPresentation:'source-node'});painter.paint({pins:[{id:'one',path:'p',anchor:{kind:'html-node',v:1,revision:'1',nodeId:'p',quote:'',presentation:'block'}}],mode:'on',openId:null,hoverId:null});expect(node.hasAttribute('style')).toBe(false);expect(node.getAttribute('data-af-comment-block')).toBe('af-block-0-base');painter.dispose();expect(node.outerHTML).toBe(original);
});

it('source node rules paint computed outlines, preserve other reserved stamps, and remove active inset when a shared thread closes',()=>{
 document.body.innerHTML='<p data-af-id="p">context</p><aside data-af-comment-block="af-block-0-base">existing</aside>';const node=document.querySelector('p')!,aside=document.querySelector('aside')!,before=aside.outerHTML;vi.spyOn(node,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,80,20));
 const painter=createHtmlAnnotationPainter(document,{blockPresentation:'source-node'}),anchor={kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'p',quote:'',presentation:'block' as const},pins=[{id:'one',path:'p',anchor},{id:'two',path:'p',anchor}],input={pins,mode:'on' as const,openId:null,hoverId:null};
 painter.paint(input);expect(node.getAttribute('data-af-comment-block')).toBe('af-block-1-base');expect(getComputedStyle(node).outline).toContain('1px solid');expect(getComputedStyle(node).outlineOffset).toBe('3px');expect(getComputedStyle(aside).outline).not.toContain('rgba(245');
 painter.paint({...input,hoverId:'two'});expect(getComputedStyle(node).boxShadow).toContain('inset');painter.paint({...input,pins:[pins[0]!]});expect(getComputedStyle(node).boxShadow).not.toContain('inset');painter.dispose();expect(aside.outerHTML).toBe(before);expect(getComputedStyle(node).outline).not.toContain('rgba(245');
});
