import {afterEach,expect,it,vi} from 'vitest';
import {createControlsFrame} from '../controls-frame';
import {STORY_ROOT_ID,STORY_READER_MODE_MESSAGE,STORY_SCROLL_MESSAGE} from '../contract';

let controls: ReturnType<typeof createControlsFrame> | undefined;
afterEach(()=>{controls?.dispose();controls=undefined;vi.restoreAllMocks();document.documentElement.className='';});
const origin='https://i.artifactbin.test';
function dispatchMessage(source: MessageEventSource | null, from: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message',{source,origin:from,data}));
}
it('requires both the exact child window and origin for geometry and appearance',()=>{
  controls=createControlsFrame(origin+'/a/example');
  const child=controls.frame.contentWindow!;
  const regions={type:'mx:controls:regions',rects:[{x:0,y:0,width:100,height:44}],rightInset:0};
  dispatchMessage(window,origin,regions);
  dispatchMessage(child,'null',regions);
  expect(controls.frame.style.clipPath).toBe('inset(100%)');
  dispatchMessage(child,origin,regions);
  expect(controls.frame.style.clipPath).toContain('path(');
  dispatchMessage(window,origin,{type:STORY_READER_MODE_MESSAGE,mode:'dark'});
  dispatchMessage(child,'https://evil.artifactbin.test',{type:STORY_READER_MODE_MESSAGE,mode:'dark'});
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  dispatchMessage(child,origin,{type:STORY_READER_MODE_MESSAGE,mode:'dark'});
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});
it('addresses scroll samples to the controls child and removes listeners on disposal',()=>{
  controls=createControlsFrame(origin+'/a/example');
  const post=vi.spyOn(controls.frame.contentWindow!,'postMessage');
  window.dispatchEvent(new Event('scroll'));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({type:STORY_SCROLL_MESSAGE,scrollY:0}),origin);
  controls.dispose();post.mockClear();
  window.dispatchEvent(new Event('scroll'));
  expect(post).not.toHaveBeenCalled();
  controls=undefined;
});
it('only the trusted child can make the artifact inert and disposal restores it',()=>{
  const root=document.createElement('main');root.id=STORY_ROOT_ID;root.inert=false;document.body.append(root);
  controls=createControlsFrame(origin+'/a/example');
  const data={type:'mx:controls:regions',rects:[],modal:true};
  dispatchMessage(window,origin,data);expect(root.inert).toBe(false);
  dispatchMessage(controls.frame.contentWindow!,origin,data);expect(root.inert).toBe(true);
  dispatchMessage(controls.frame.contentWindow!,origin,{...data,modal:false});expect(root.inert).toBe(false);
  root.inert=true;
  dispatchMessage(controls.frame.contentWindow!,origin,data);
  controls.dispose();controls=undefined;expect(root.inert).toBe(true);root.remove();
});
it('relays unhandled Escape only and removes the relay on disposal',()=>{
  controls=createControlsFrame(origin+'/a/example');
  const post=vi.spyOn(controls.frame.contentWindow!,'postMessage');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  expect(post).toHaveBeenCalledWith({type:'mx:controls:escape'},origin);
  post.mockClear();
  const handled=new KeyboardEvent('keydown',{key:'Escape',cancelable:true});handled.preventDefault();document.dispatchEvent(handled);
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));expect(post).not.toHaveBeenCalled();
  controls.dispose();controls=undefined;
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(post).not.toHaveBeenCalled();
});
