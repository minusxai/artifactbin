import {afterEach, describe, expect, it, vi} from 'vitest';
import {beginCapture, captureAvailable, clipCaptureRect} from '../screen';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
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
