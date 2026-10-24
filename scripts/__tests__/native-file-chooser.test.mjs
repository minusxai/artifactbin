import { describe, expect, it } from 'vitest';
import { withNativeFileChooser } from '../gates/lib/native-file-chooser.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
  const steps=[],armed=deferred(),opened=deferred(),arming=deferred();
  const chooser={isMultiple:()=>true};
  const listeners=new Map(),protocolListeners=new Map();
  const session={
    on:(name,listener)=>protocolListeners.set(name,listener),
    send:async(name,parameters)=>{
      steps.push([name,parameters]);
      if(name==='Page.setInterceptFileChooserDialog'&&parameters.enabled){arming.resolve();await armed.promise;}
    },
    detach:async()=>{steps.push(['detach']);},
  };
  const page={context:()=>({newCDPSession:async()=>session}),on:(name,listener)=>{steps.push(['listen',name]);listeners.set(name,listener);},off:(name)=>{steps.push(['unlisten',name]);listeners.delete(name);},waitForEvent:(name,options)=>{steps.push(['wait',name,options]);return opened.promise;}};
  const activate=async()=>{steps.push(['trusted Enter']);protocolListeners.get('Page.fileChooserOpened')?.({mode:'selectMultiple',backendNodeId:7});listeners.get('filechooser')?.(chooser);opened.resolve(chooser);};
  return {steps,armed,arming,opened,chooser,listeners,session,page,activate};
}
describe('acknowledged native chooser boundary',()=>{
  it('does not send trusted Enter until Chromium acknowledges interception',async()=>{
    const f=fixture(),diagnostics={};
    const run=withNativeFileChooser(f.page,f.activate,async chooser=>{expect(chooser).toBe(f.chooser);f.steps.push(['setFiles']);return 'selected';},{timeout:2000,diagnostics});
    await Promise.race([f.arming.promise,run]);
    expect(f.steps.some(([step])=>step==='trusted Enter')).toBe(false);
    f.armed.resolve();
    expect(await run).toBe('selected');
    expect(f.steps.map(([step])=>step)).toEqual(['listen','Page.enable','Page.setInterceptFileChooserDialog','wait','trusted Enter','setFiles','Page.setInterceptFileChooserDialog','unlisten','detach']);
    expect(f.steps.find(([step])=>step==='wait')[2]).toEqual({timeout:2000});
    expect(diagnostics).toMatchObject({armed:true,playwrightEvents:1,protocolEvents:[{mode:'selectMultiple',backendNodeId:7}]});
    expect(f.listeners.size).toBe(0);
  });
  it('cleans up interception and the session when native file handling fails',async()=>{
    const f=fixture();f.armed.resolve();
    await expect(withNativeFileChooser(f.page,f.activate,async()=>{throw new Error('selection failed');})).rejects.toThrow('selection failed');
    expect(f.steps.slice(-3)).toEqual([['Page.setInterceptFileChooserDialog',{enabled:false}],['unlisten','filechooser'],['detach']]);
  });
  it('never activates input when arming fails and still detaches the session',async()=>{
    const f=fixture();
    const run=withNativeFileChooser(f.page,f.activate,async()=>{});
    await Promise.race([f.arming.promise,run]);f.armed.reject(new Error('protocol unavailable'));
    await expect(run).rejects.toThrow('protocol unavailable');
    expect(f.steps.some(([step])=>step==='trusted Enter')).toBe(false);
    expect(f.steps.at(-1)).toEqual(['detach']);expect(f.listeners.size).toBe(0);
  });
});
