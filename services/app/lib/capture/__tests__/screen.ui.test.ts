import {afterEach, describe, expect, it, vi} from 'vitest';
import {beginCapture, captureAvailable, clipCaptureRect} from '../screen';

const originalFrame=Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype,'requestVideoFrameCallback');
const originalCancel=Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype,'cancelVideoFrameCallback');
afterEach(()=>{
 vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();
 for(const [name,descriptor] of [['requestVideoFrameCallback',originalFrame],['cancelVideoFrameCallback',originalCancel]] as const){
  if(descriptor)Object.defineProperty(HTMLVideoElement.prototype,name,descriptor);
  else Reflect.deleteProperty(HTMLVideoElement.prototype,name);
 }
});
describe('screen capture resource contract',()=>{
 it('clips a cross-block screenshot to the viewport, independently of its anchor',()=>{
  expect(clipCaptureRect({x:-5,y:20,width:200,height:100},{width:100,height:80})).toEqual({x:0,y:20,width:100,height:60});
  expect(()=>clipCaptureRect({x:200,y:0,width:20,height:20},{width:100,height:80})).toThrow();
 });
 it('does not advertise capture without source verification',()=>{
  vi.stubGlobal('navigator',{mediaDevices:{getDisplayMedia:vi.fn()}});
  expect(captureAvailable()).toBe(false);
 });
 it('invokes the native picker synchronously and stops a wrong-tab stream',async()=>{
  const stop=vi.fn();const getDisplayMedia=vi.fn().mockResolvedValue({getTracks:()=>[{stop}],getVideoTracks:()=>[{stop,getSettings:()=>({displaySurface:'browser'}),getCaptureHandle:()=>({handle:'another-tab'})}]});
  vi.stubGlobal('navigator',{mediaDevices:{getDisplayMedia,setCaptureHandleConfig:vi.fn()}});
  const pending=beginCapture();expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  await expect(pending).rejects.toMatchObject({code:'wrong-source'});expect(stop).toHaveBeenCalledOnce();
 });
 it('distinguishes permission cancellation',async()=>{
  vi.stubGlobal('navigator',{mediaDevices:{getDisplayMedia:vi.fn().mockRejectedValue(new DOMException('Denied','NotAllowedError')),setCaptureHandleConfig:vi.fn()}});
  await expect(beginCapture()).rejects.toMatchObject({code:'cancelled'});
 });
});

it.each(['success','resize','crop-stall','frame-stall'] as const)('handles static crop delivery, geometry and stalled browser stages (%s)',async(scenario)=>{
 const changed=scenario==='resize';vi.useFakeTimers();
 let handle='',callback:VideoFrameRequestCallback|undefined,video:HTMLVideoElement|undefined;
 let cropped=false,initialDelivered=false;
 const stop=vi.fn();const track=Object.assign(new EventTarget(),{stop,readyState:'live',getSettings:()=>({displaySurface:'browser'}),getCaptureHandle:()=>({handle}),cropTo:async()=>{
  cropped=true;
  if(scenario==='crop-stall')return new Promise<void>(()=>{});
  if(scenario==='frame-stall')return;Object.defineProperty(video!,'videoWidth',{configurable:true,value:200});Object.defineProperty(video!,'videoHeight',{configurable:true,value:100});
  if(changed)vi.stubGlobal('innerWidth',window.innerWidth+10);
  window.dispatchEvent(new Event('resize')); // Chrome can notify without changing the viewport when cropping.
  callback?.(performance.now(),{width:200,height:100} as VideoFrameCallbackMetadata);callback=undefined;
 }});
 vi.stubGlobal('navigator',{mediaDevices:{setCaptureHandleConfig:(config:{handle:string})=>{handle=config.handle;},getDisplayMedia:vi.fn().mockResolvedValue({getTracks:()=>[track],getVideoTracks:()=>[track]})}});
 vi.stubGlobal('CropTarget',{fromElement:async()=>({})});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLVideoElement){video=this;Object.defineProperty(this,'videoWidth',{configurable:true,value:window.innerWidth});Object.defineProperty(this,'videoHeight',{configurable:true,value:window.innerHeight});return Promise.resolve();});
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 Object.defineProperty(HTMLVideoElement.prototype,'requestVideoFrameCallback',{configurable:true,value:function(cb:VideoFrameRequestCallback){callback=cb;if(!cropped&&!initialDelivered){initialDelivered=true;queueMicrotask(()=>{if(callback===cb){callback=undefined;cb(performance.now(),{} as VideoFrameCallbackMetadata);}});}return 1;}});
 Object.defineProperty(HTMLVideoElement.prototype,'cancelVideoFrameCallback',{configurable:true,value:()=>{callback=undefined;}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['pixels'],{type:'image/png'})));
 const starting=beginCapture();await vi.advanceTimersByTimeAsync(0);const session=await starting;
 const pending=session.capture({x:5,y:5,width:200,height:100}).catch(error=>error);
 await vi.advanceTimersByTimeAsync(5001);const result=await pending;
 if(changed)expect(result).toMatchObject({code:'geometry'});
 else if(scenario==='crop-stall'||scenario==='frame-stall')expect(result).toMatchObject({code:'timeout',stage:scenario==='crop-stall'?'crop-apply':'cropped-frame'});
 else expect(result).toMatchObject({method:'region',width:200,height:100});
 expect(stop).toHaveBeenCalledOnce();
},7000);

it('identifies a stalled initial frame and stops sharing at the deadline',async()=>{
 vi.useFakeTimers();let handle='';const stop=vi.fn();
 const track=Object.assign(new EventTarget(),{stop,readyState:'live',getSettings:()=>({displaySurface:'browser'}),getCaptureHandle:()=>({handle})});
 vi.stubGlobal('navigator',{mediaDevices:{setCaptureHandleConfig:(config:{handle:string})=>{handle=config.handle;},getDisplayMedia:vi.fn().mockResolvedValue({getTracks:()=>[track],getVideoTracks:()=>[track]})}});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 Object.defineProperty(HTMLVideoElement.prototype,'requestVideoFrameCallback',{configurable:true,value:()=>1});
 const cancel=vi.fn();Object.defineProperty(HTMLVideoElement.prototype,'cancelVideoFrameCallback',{configurable:true,value:cancel});
 const pending=beginCapture().catch(error=>error);
 await vi.advanceTimersByTimeAsync(5001);expect(await pending).toMatchObject({code:'timeout',stage:'initial-frame'});expect(stop).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalled();
});
