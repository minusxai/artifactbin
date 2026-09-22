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

it.each(['success','timeout','wrong-source','resize','ended'] as const)('reads directly from the track without video callbacks and releases bitmaps (%s)',async(scenario)=>{
 vi.useFakeTimers();let handle='',resolveFrame!:(bitmap:ImageBitmap)=>void;
 const warmupClose=vi.fn(),warmup={width:window.innerWidth,height:window.innerHeight,close:warmupClose} as unknown as ImageBitmap;
 const close=vi.fn(),bitmap={width:window.innerWidth,height:window.innerHeight,close} as unknown as ImageBitmap;
 const stop=vi.fn(),track=Object.assign(new EventTarget(),{stop,readyState:'live',getSettings:()=>({displaySurface:'browser'}),getCaptureHandle:()=>({handle}),cropTo:()=>{throw new Error('Native region cropping must not be used');}});
 let reads=0;const grabFrame=vi.fn(()=>{if(reads++===0)return Promise.resolve(warmup);if(scenario==='wrong-source')handle='different-tab';if(scenario==='resize'){vi.stubGlobal('innerWidth',innerWidth+10);window.dispatchEvent(new Event('resize'));}if(scenario==='ended')track.dispatchEvent(new Event('ended'));return scenario==='timeout'?new Promise<ImageBitmap>(resolve=>{resolveFrame=resolve;}):Promise.resolve(bitmap);});
 vi.stubGlobal('ImageCapture',class {grabFrame=grabFrame;});
 vi.stubGlobal('navigator',{mediaDevices:{setCaptureHandleConfig:(config:{handle:string})=>{handle=config.handle;},getDisplayMedia:vi.fn().mockResolvedValue({getTracks:()=>[track],getVideoTracks:()=>[track]})}});
 vi.stubGlobal('CropTarget',{fromElement:async()=>({})});
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockRejectedValue(new Error('Video playback must not be needed'));
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 Object.defineProperty(HTMLVideoElement.prototype,'requestVideoFrameCallback',{configurable:true,value:()=>1});
 Object.defineProperty(HTMLVideoElement.prototype,'cancelVideoFrameCallback',{configurable:true,value:()=>{}});
 const drawImage=vi.fn();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['pixels'],{type:'image/png'})));
 const session=await beginCapture();const pending=session.capture({x:5,y:5,width:200,height:100}).catch(error=>error);
 await vi.advanceTimersByTimeAsync(5100);const result=await pending;
 expect(play).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledOnce();
 if(scenario==='timeout'){expect(result).toMatchObject({code:'timeout',stage:'track-frame'});resolveFrame(bitmap);await Promise.resolve();expect(drawImage).not.toHaveBeenCalled();}
 else if(scenario==='wrong-source'||scenario==='resize'||scenario==='ended'){expect(result).toMatchObject({code:scenario==='resize'?'geometry':scenario});expect(drawImage).not.toHaveBeenCalled();}
 else {expect(result).toMatchObject({method:'canvas',width:200,height:100});expect(drawImage).toHaveBeenCalledWith(bitmap,5,5,200,100,0,0,200,100);}
 expect(close).toHaveBeenCalledOnce();expect(warmupClose).toHaveBeenCalledOnce();expect(drawImage.mock.calls.every(call=>call[0]!==warmup)).toBe(true);
});
