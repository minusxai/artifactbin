import {afterEach,expect,it,vi} from 'vitest';
const bridges:Array<{dispose():void}>=[];
afterEach(()=>{for(const bridge of bridges.splice(0))bridge.dispose();document.body.innerHTML='';vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
for(const imported of [true,false])it(`keeps ${imported?'imported source':'native'} lifecycle while scroll, resize, input and text reflow stay live`,async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p1',revision:'1',backends:[],...(imported?{annotationObservation:'imported-source-v1'}:{})});
 document.body.innerHTML='<section><h2 data-af-id="heading">Heading</h2></section>';
 const panel=document.querySelector('section')!,heading=document.querySelector('h2')!;let y=208;
 vi.spyOn(heading,'getBoundingClientRect').mockImplementation(()=>({x:16,y:panel.hidden?0:y,width:panel.hidden?0:200,height:panel.hidden?0:32,top:panel.hidden?0:y,left:16,right:216,bottom:y+32,toJSON(){return {};}}));
 const queued:FrameRequestCallback[]=[];vi.spyOn(window,'requestAnimationFrame').mockImplementation(cb=>{queued.push(cb);return queued.length;});vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
 const flush=async()=>{for(let i=0;i<8;i++){await Promise.resolve();for(const cb of queued.splice(0))cb(0);}};
 const events:any[]=[];const {startFrameBridge}=await import('../browser-client');const bridge=startFrameBridge({win:window,post:event=>events.push(event)});bridges.push(bridge);
 bridge.receive({kind:'send',command:{type:'mx:annotations',mode:'on',pins:[{id:'thread',path:'heading',anchor:{kind:'html-node',v:1,revision:'1',nodeId:'heading',quote:'',presentation:'block'}}],openId:null,hoverId:null}});await flush();
 const position=()=>events.filter(item=>item.event?.type==='mx:annotation-layout').at(-1).event.positions[0].rect.y;
 expect(position()).toBe(208);panel.hidden=true;await flush();expect(position()).toBe(imported?208:0);
 window.dispatchEvent(new Event('scroll'));await flush();expect(position()).toBe(0);
 panel.hidden=false;window.dispatchEvent(new Event('resize'));await flush();expect(position()).toBe(208);
 y=333;document.dispatchEvent(new Event('input'));await flush();if(imported)expect(position()).toBe(333);
 y=444;heading.firstChild!.textContent='New words';await flush();expect(position()).toBe(444);
});
