import {afterEach,expect,it,vi} from 'vitest';
const bridges:Array<{dispose():void}>=[];
afterEach(()=>{for(const bridge of bridges.splice(0))bridge.dispose();document.body.innerHTML='';Reflect.deleteProperty(document,'fonts');vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
for(const imported of [true,false])it(`keeps ${imported?'imported source':'native'} lifecycle while scroll, resize, input and text reflow stay live`,async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p1',revision:'1',backends:[],...(imported?{annotationObservation:'imported-source-v1'}:{})});
 vi.spyOn(window,'scrollY','get').mockReturnValue(100);
 document.body.innerHTML='<section><h2 data-af-id="heading">Heading</h2></section>';
 const panel=document.querySelector('section')!,heading=document.querySelector('h2')!;let y=208;
 vi.spyOn(heading,'getBoundingClientRect').mockImplementation(()=>({x:16,y:panel.hidden?0:y,width:panel.hidden?0:200,height:panel.hidden?0:32,top:panel.hidden?0:y,left:16,right:216,bottom:y+32,toJSON(){return {};}}));
 const queued:FrameRequestCallback[]=[];vi.spyOn(window,'requestAnimationFrame').mockImplementation(cb=>{queued.push(cb);return queued.length;});vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
 const flush=async()=>{for(let i=0;i<8;i++){await Promise.resolve();for(const cb of queued.splice(0))cb(0);}};
 const events:any[]=[];const {startFrameBridge}=await import('../browser-client');const bridge=startFrameBridge({win:window,post:event=>events.push(event)});bridges.push(bridge);
 bridge.receive({kind:'send',command:{type:'mx:annotations',mode:'on',pins:[{id:'thread',path:'heading',anchor:{kind:'html-node',v:1,revision:'1',nodeId:'heading',quote:'',presentation:'block'}}],openId:null,hoverId:null}});await flush();
 const position=()=>events.filter(item=>item.event?.type==='mx:annotation-layout').at(-1).event.positions[0].rect.y;
 expect(position()).toBe(208);const mark=()=>document.querySelector('[data-af=annotation-overlay]>div') as HTMLElement|null;
 if(imported){expect(heading.getAttribute('data-af-comment-block')).toBe('af-block-0-base');expect(mark()).toBeNull();}else{expect(mark()!.style.position).toBe('fixed');expect(mark()!.style.top).toBe('208px');expect(heading.hasAttribute('data-af-comment-block')).toBe(false);}
 const eventCount=events.length;await flush();expect(events).toHaveLength(eventCount);expect(queued).toHaveLength(0);
 panel.hidden=true;await flush();expect(position()).toBe(imported?208:0);expect(mark()).toBeNull();expect(heading.hasAttribute('data-af-comment-block')).toBe(false);
 window.dispatchEvent(new Event('scroll'));await flush();expect(position()).toBe(0);
 panel.hidden=false;window.dispatchEvent(new Event('resize'));await flush();expect(position()).toBe(208);
 y=333;document.dispatchEvent(new Event('input'));await flush();if(imported)expect(position()).toBe(333);
 y=444;heading.firstChild!.textContent='New words';await flush();expect(position()).toBe(444);
});
it('does not report imported missing anchors before initial document and font readiness',async()=>{
 let complete=false,releaseFonts!:()=>void;const fonts=new Promise<void>(resolve=>{releaseFonts=resolve;});
 vi.spyOn(document,'readyState','get').mockImplementation(()=>complete?'complete':'loading');
 Object.defineProperty(document,'fonts',{configurable:true,get:()=>({ready:fonts})});
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p1',revision:'1',backends:[],annotationObservation:'imported-source-v1'});
 document.body.innerHTML='';const events:any[]=[];const{startFrameBridge}=await import('../browser-client');const bridge=startFrameBridge({win:window,post:event=>events.push(event)});bridges.push(bridge);
 bridge.receive({kind:'send',command:{type:'mx:annotations',mode:'on',pins:[{id:'thread',path:'heading',anchor:{kind:'html-node',v:1,revision:'1',nodeId:'heading',quote:'',presentation:'block'}}],openId:null,hoverId:null}});
 for(let i=0;i<8;i++)await Promise.resolve();const layouts=()=>events.filter(item=>item.event?.type==='mx:annotation-layout');expect(layouts()).toHaveLength(0);
 document.body.innerHTML='<h2 data-af-id="heading">Ready heading</h2>';vi.spyOn(document.querySelector('h2')!,'getBoundingClientRect').mockReturnValue(new DOMRect(16,208,200,32));
 complete=true;window.dispatchEvent(new Event('load'));await Promise.resolve();expect(layouts()).toHaveLength(0);releaseFonts();for(let i=0;i<8;i++)await Promise.resolve();
 expect(layouts().at(-1).event.positions).toEqual([{id:'thread',status:'exact',rect:{x:16,y:208,width:200,height:32}}]);
});
