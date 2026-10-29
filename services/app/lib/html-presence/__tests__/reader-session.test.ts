import {expect,it} from 'vitest';
import {createReaderPresenceSession} from '../reader-session';
import {readerDefaults,type PresencePublication,type PresencePaint,type PresenceViewer} from '../contract';
it('owns revision and tab identity, honors separate send/display preferences, expires peers and clears on disposal',async()=>{
 let now=1000,tick=()=>{},every=0,incoming=(_viewers:PresenceViewer[])=>{},stopped=false,active=true;
 let prefs={...readerDefaults};const published:PresencePublication[]=[],painted:PresencePaint[]=[];
 const session=createReaderPresenceSession({session:'private-parent-session',revision:'4',nonce:'signed',readPreferences:()=>prefs,active:()=>active,
  publish:async input=>{published.push(input);return 'own';},connect:receive=>{incoming=receive;return()=>{stopped=true;}},paint:input=>painted.push(input),changed:()=>{},clock:{now:()=>now,setInterval:(work,ms)=>{tick=work;every=ms;return 1;},clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{}}});
 await Promise.resolve();expect(every).toBe(15_000);
 session.receive({type:'mx:presence',nonce:'forged',geometry:{cursor:{nodeId:'a',x:.2,y:.3}}});tick();await Promise.resolve();expect(published.at(-1)?.cursor).toBeNull();
 session.receive({type:'mx:presence',nonce:'signed',revision:'spoof',session:'spoof',geometry:{cursor:{nodeId:'a',x:.2,y:.3}}});tick();await Promise.resolve();expect(published.at(-1)).toMatchObject({session:'private-parent-session',revision:'4',cursor:{nodeId:'a',x:.2,y:.3}});
 incoming([{id:'other-tab',label:'Same account',revision:'4',seen:now,cursor:{nodeId:'a',x:0,y:1},selection:null},{id:'own',label:'Self',revision:'4',seen:now,cursor:null,selection:null}]);expect(painted.at(-1)?.viewers.map(v=>v.id)).toEqual(['other-tab']);
 prefs={...prefs,shareCursor:false,showSelections:false};session.preferencesChanged();await Promise.resolve();expect(published.at(-1)?.cursor).toBeNull();expect(painted.at(-1)?.preferences.showSelections).toBe(false);
 active=false;session.activeChanged();await Promise.resolve();expect(published.at(-1)?.visible).toBe(false);
 now+=44_999;tick();await Promise.resolve();expect(painted.at(-1)?.viewers.map(v=>v.id)).toEqual(['other-tab']);
 now+=1;tick();await Promise.resolve();expect(painted.at(-1)?.viewers).toEqual([]);
 session.dispose();expect(stopped).toBe(true);expect(published.at(-1)?.visible).toBe(false);
});
it('coalesces pointer activity at 250ms and sends hide after an in-flight heartbeat settles',async()=>{
 let scheduled:()=>void=()=>{},delay=0;let resolve:((id:string)=>void)|undefined;const sent:PresencePublication[]=[];
 const session=createReaderPresenceSession({session:'tab',revision:'1',nonce:'n',readPreferences:()=>readerDefaults,active:()=>true,publish:input=>{sent.push(input);return new Promise(r=>{resolve=r;});},connect:()=>()=>{},paint:()=>{},changed:()=>{},clock:{now:()=>0,setInterval:()=>1,clearInterval:()=>{},setTimeout:(work,ms)=>{scheduled=work;delay=ms;return 2;},clearTimeout:()=>{}}});
 resolve!('own');await Promise.resolve();
 session.receive({type:'mx:presence',nonce:'n',geometry:{cursor:{nodeId:'a',x:0,y:0}}});session.receive({type:'mx:presence',nonce:'n',geometry:{cursor:{nodeId:'a',x:1,y:1}}});
 expect(delay).toBe(250);expect(sent).toHaveLength(1);scheduled();expect(sent.at(-1)?.cursor).toMatchObject({x:1,y:1});
 session.dispose();expect(sent.at(-1)?.visible).toBe(true);resolve!('own');await Promise.resolve();expect(sent.at(-1)?.visible).toBe(false);
});
