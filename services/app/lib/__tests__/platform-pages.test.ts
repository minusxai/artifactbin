import {expect,it,vi} from 'vitest';
import {runInNewContext} from 'node:vm';
import {platformPageResponse} from '@artifactbin/utils/platform-pages';

const main='https://artifactbin.test',controls='https://i.artifactbin.test';
async function shell(path='/login',search='?callbackUrl=%2Faccount') {
  const html=await platformPageResponse(main,controls,path,search).text();
  const script=/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1];
  const handlers=new Map<string,(event:unknown)=>void>();
  const frame={contentWindow:{postMessage:vi.fn()},src:''};
  const loading={hidden:false,firstChild:{textContent:''}};
  const retry={hidden:true,addEventListener:vi.fn()};
  const location={href:main+path+search+'#keep',hash:'#keep',assign:vi.fn(),replace:vi.fn()};
  const history={go:vi.fn()};
  runInNewContext(script,{URL,document:{getElementById:(id:string)=>({'app-frame':frame,loading,retry})[id as 'loading']},
    location,history,window:{addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler)},setTimeout:vi.fn(),clearTimeout:vi.fn()});
  const message=(data:unknown,origin=controls,source:unknown=frame.contentWindow)=>handlers.get('message')!({data,origin,source});
  return {html,frame,loading,retry,location,history,message};
}
it('delegates clipboard only to the trusted page frame',async()=>{
  const {html}=await shell();expect(html).toContain('allow="clipboard-write"');
});
it('reloads the current public address after trusted session changes',async()=>{
  const s=await shell('/','');
  s.message({type:'mx:controls:navigate',url:s.location.href});
  expect(s.location.assign).toHaveBeenCalledExactlyOnceWith(s.location.href);
});
it('retains explicit referrer and device capability denial headers',()=>{
  const response=platformPageResponse(main,controls,'/login','');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
});
it('accepts navigation only from its exact trusted frame and only to public page addresses',async()=>{
  const s=await shell();
  expect(s.frame.src).toBe(controls+'/controls/page/login?callbackUrl=%2Faccount#keep');
  const send=(url:string,origin=controls,source:unknown=s.frame.contentWindow)=>s.message({type:'mx:controls:navigate',url},origin,source);
  for(const url of [main+'/api/my/tokens',main+'/controls/page/account',main+'/unknown',main+'/assets/ref/abc',controls+'/account','https://evil.test/',main+'/\\evil.test'])send(url);
  send(main+'/account','null');send(main+'/account',main);send(main+'/account',controls,{});
  expect(s.location.assign).not.toHaveBeenCalled();
  send(main+'/account');expect(s.location.assign).toHaveBeenCalledExactlyOnceWith(main+'/account');
  s.message({type:'mx:controls:navigate',url:main+'/a/abc123?$x=a#keep',replace:true});
  expect(s.location.replace).toHaveBeenCalledExactlyOnceWith(main+'/a/abc123?$x=a#keep');
});
it('does not let unrelated frames dismiss loading or move history',async()=>{
  const s=await shell();s.message({type:'mx:page:ready'},controls,{});expect(s.loading.hidden).toBe(false);
  s.message({type:'mx:page:history',delta:900});expect(s.history.go).not.toHaveBeenCalled();
  s.message({type:'mx:page:ready'});expect(s.loading.hidden).toBe(true);
  s.message({type:'mx:page:history',delta:-1});expect(s.history.go).toHaveBeenCalledExactlyOnceWith(-1);
});
it('allows a registered OAuth callback only in the dedicated consent wrapper',async()=>{
  const callback='http://127.0.0.1:9987/callback?fixed=yes';
  const s=await shell('/oauth/authorize','?'+new URLSearchParams({redirect_uri:callback,state:'kept'}));
  const send=(url:string,origin=controls,source:unknown=s.frame.contentWindow)=>s.message({type:'mx:consent:complete',url},origin,source);
  for(const url of [callback+'&code=abc&state=wrong',callback+'&code=abc&state=kept&extra=bad',callback.replace('callback','evil')+'&code=abc&state=kept',callback.replace('9987','9988')+'&code=abc&state=kept','javascript:alert(1)'])send(url);
  const approved=callback+'&code=abc&state=kept';
  send(approved,'null');send(approved,controls,{});expect(s.location.assign).not.toHaveBeenCalled();
  send(approved);expect(s.location.assign).toHaveBeenCalledExactlyOnceWith(approved);
  const ordinary=await shell();ordinary.message({type:'mx:consent:complete',url:approved});expect(ordinary.location.assign).not.toHaveBeenCalled();
});
