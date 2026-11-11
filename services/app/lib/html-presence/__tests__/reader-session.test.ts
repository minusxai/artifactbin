import {expect,it} from 'vitest';
import {createReaderPresenceSession} from '../reader-session';
import {readerDefaults,type PresenceFrame,type PresencePublication,type PresencePaint} from '../contract';
it('owns revision and tab identity, honors separate send/display preferences, expires peers and clears on disposal',async()=>{
 let now=1000,tick=()=>{},every=0,incoming=(_frame:PresenceFrame)=>{},stopped=false,active=true;
 let prefs={...readerDefaults};const published:PresencePublication[]=[],painted:PresencePaint[]=[];
 const session=createReaderPresenceSession({session:'private-parent-session',revision:'4',nonce:'signed',readPreferences:()=>prefs,active:()=>active,
  publish:async input=>{published.push(input);return 'own';},connect:receive=>{incoming=receive;return()=>{stopped=true;}},paint:input=>painted.push(input),changed:()=>{},clock:{now:()=>now,setInterval:(work,ms)=>{tick=work;every=ms;return 1;},clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{}}});
 await Promise.resolve();expect(every).toBe(15_000);
 session.receive({type:'mx:presence',nonce:'forged',geometry:{cursor:{nodeId:'a',x:.2,y:.3}}});tick();await Promise.resolve();expect(published.at(-1)?.cursor).toBeNull();
 session.receive({type:'mx:presence',nonce:'signed',revision:'spoof',session:'spoof',geometry:{cursor:{nodeId:'a',x:.2,y:.3}}});tick();await Promise.resolve();expect(published.at(-1)).toMatchObject({session:'private-parent-session',revision:'4',cursor:{nodeId:'a',x:.2,y:.3}});
 incoming({viewers:[{id:'other-tab',label:'Same account',revision:'4',seen:now,cursor:{nodeId:'a',x:0,y:1},selection:null},{id:'own',label:'Self',revision:'4',seen:now,cursor:null,selection:null}],total:2});expect(painted.at(-1)?.viewers.map(v=>v.id)).toEqual(['other-tab']);
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
it('uses personalized complete counts and a visible unique lower bound on legacy servers',async()=>{
 let incoming=(_frame:PresenceFrame)=>{},prefs={...readerDefaults};const counts:Array<[string[],number]>=[];
 const session=createReaderPresenceSession({session:'tab',revision:'1',nonce:'n',readPreferences:()=>prefs,active:()=>true,publish:async()=> 'own',connect:receive=>{incoming=receive;return()=>{};},paint:()=>{},changed:(viewers,total)=>counts.push([viewers.map(v=>v.id),total]),clock:{now:()=>0,setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{}}});
 await Promise.resolve();
 const peer=(id:string)=>({id,label:'Guest',revision:'1',seen:0,cursor:null,selection:null});
 // New servers supply the complete other-reader count even when self is outside the geometry cap.
 incoming({viewers:[peer('a'),peer('b')],total:40,readers:{total:39,expiresAt:45000}});expect(counts.at(-1)).toEqual([['a','b'],39]);
 incoming({viewers:[peer('own'),peer('a')],total:40,readers:{total:39,expiresAt:45000}});expect(counts.at(-1)).toEqual([['a'],39]);
 // Hidden: the room no longer holds this tab, so every reader it counts is someone else.
 prefs={...prefs,visible:false};session.preferencesChanged();await Promise.resolve();
 incoming({viewers:[peer('a')],total:39,readers:{total:39,expiresAt:45000}});expect(counts.at(-1)).toEqual([['a'],39]);
 // Old servers have session totals; only the visible unique lower bound is safe.
 incoming({viewers:[peer('a'),peer('b')],total:0});expect(counts.at(-1)).toEqual([['a','b'],2]);
 session.dispose();
});
it('publishes the frame\'s region caret beside its geometry, as a cursor the reader chose to share, until the editor blurs',async()=>{
 let scheduled:()=>void=()=>{},prefs={...readerDefaults};const sent:PresencePublication[]=[];
 const session=createReaderPresenceSession({session:'tab',revision:'1',nonce:'n',readPreferences:()=>prefs,active:()=>true,publish:async input=>{sent.push(input);return 'own';},connect:()=>()=>{},paint:()=>{},changed:()=>{},clock:{now:()=>0,setInterval:()=>1,clearInterval:()=>{},setTimeout:work=>{scheduled=work;return 2;},clearTimeout:()=>{}}});
 await Promise.resolve();
 session.regionCaret({regionId:'af-6',anchor:'AQID',head:'BAUG'});scheduled();await Promise.resolve();
 expect(sent.at(-1)).toMatchObject({region:{regionId:'af-6',anchor:'AQID',head:'BAUG'}});
 // A pointer move in the frame replaces its geometry, not the region caret.
 session.receive({type:'mx:presence',nonce:'n',geometry:{cursor:{nodeId:'a',x:0,y:0}}});scheduled();await Promise.resolve();
 expect(sent.at(-1)).toMatchObject({cursor:{nodeId:'a'},region:{regionId:'af-6'}});
 session.regionCaret({regionId:'bad id',anchor:'AQID',head:'BAUG'});scheduled();await Promise.resolve();
 expect(sent.at(-1)?.region).toBeUndefined();
 session.regionCaret({regionId:'af-6',anchor:'AQID',head:'BAUG'});prefs={...prefs,shareCursor:false};session.preferencesChanged();await Promise.resolve();
 expect(sent.at(-1)?.region).toBeUndefined();
 prefs={...prefs,shareCursor:true};session.regionCaret(null);scheduled();await Promise.resolve();
 expect(sent.at(-1)?.region).toBeUndefined();
 session.dispose();
});

it('does not expose any unresolved own identity through the roster before publication returns',async()=>{
 let incoming=(_frame:PresenceFrame)=>{},resolve!:(id:string)=>void;
 const shown:string[][]=[];
 const session=createReaderPresenceSession({session:'tab',revision:'1',nonce:'n',readPreferences:()=>readerDefaults,active:()=>true,publish:()=>new Promise(r=>{resolve=r;}),connect:receive=>{incoming=receive;return()=>{};},paint:()=>{},changed:viewers=>shown.push(viewers.map(v=>v.id)),clock:{now:()=>0,setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{}}});
 const peer=(id:string)=>({id,label:'Same label',revision:'1',seen:0,cursor:null,selection:null});
 incoming({viewers:[peer('own'),peer('other')],total:2});
 expect(shown.at(-1)).toEqual([]);
 resolve('own');await Promise.resolve();expect(shown.at(-1)).toEqual(['other']);session.dispose();
});
it('excludes every own-account tab even hidden or capped, retains peer geometry and expires stale counts',async()=>{
 let now=1,incoming=(_frame:PresenceFrame)=>{},expiry=()=>{},prefs={...readerDefaults};const counts:Array<[string[],number]>=[];
 const session=createReaderPresenceSession({session:'tab',revision:'1',nonce:'n',readPreferences:()=>prefs,active:()=>true,publish:async()=>({id:'own',colorId:'account-a'}),connect:receive=>{incoming=receive;return()=>{};},paint:()=>{},changed:(viewers,total)=>counts.push([viewers.map(v=>v.id),total]),clock:{now:()=>now,setInterval:()=>1,clearInterval:()=>{},setTimeout:work=>{expiry=work;return 2;},clearTimeout:()=>{}}});
 await Promise.resolve();
 const peer=(id:string,colorId:string)=>({id,colorId,label:'Same label',revision:'1',seen:1,cursor:null,selection:null});
 incoming({viewers:[peer('own','account-a'),peer('own2','account-a'),peer('own3','account-a')],total:3,readers:{total:0,expiresAt:45001}});expect(counts.at(-1)).toEqual([[],0]);
 prefs={...prefs,visible:false};session.preferencesChanged();await Promise.resolve();
 incoming({viewers:[peer('own2','account-a'),peer('b1','account-b'),peer('b2','account-b'),peer('b3','account-b')],total:40,readers:{total:1,expiresAt:45001}});expect(counts.at(-1)).toEqual([['b1','b2','b3'],1]);
 incoming({viewers:[peer('b1','account-b'),peer('c','account-c')],total:40,readers:{total:2,expiresAt:45001}});expect(counts.at(-1)?.[1]).toBe(2);
 now=45001;expiry();await Promise.resolve();expect(counts.at(-1)).toEqual([[],0]);session.dispose();
});

it('withholds an unresolved legacy account roster, then converges when own trusted entry arrives',async()=>{
 let incoming=(_frame:PresenceFrame)=>{};const counts:number[]=[];
 const session=createReaderPresenceSession({session:'tab',revision:'1',nonce:'n',readPreferences:()=>readerDefaults,active:()=>true,publish:async()=> 'own',connect:receive=>{incoming=receive;return()=>{};},paint:()=>{},changed:(_viewers,total)=>counts.push(total),clock:{now:()=>0,setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{}}});
 await Promise.resolve();
 const peer=(id:string,colorId:string)=>({id,colorId,label:'Same label',revision:'1',seen:0,cursor:null,selection:null});
 incoming({viewers:[peer('own-other-tab','a'),peer('b','b')],total:40});expect(counts.at(-1)).toBe(0);
 incoming({viewers:[peer('own','a'),peer('own-other-tab','a'),peer('b','b')],total:40});expect(counts.at(-1)).toBe(1);session.dispose();
});
