import {CaptureError, type CaptureRect, type CaptureSession} from './contract';

interface CaptureTrack extends MediaStreamTrack {
  getCaptureHandle?: () => {handle?: string} | null;
  cropTo?: (target: unknown) => Promise<void>;
}
interface CaptureDevices extends MediaDevices {
  setCaptureHandleConfig?: (config: {handle: string; permittedOrigins: string[]; exposeOrigin: boolean}) => void;
}
let handle: string | undefined;
const viewport = () => ({width: window.innerWidth, height: window.innerHeight});
export function captureAvailable(): boolean {
  const devices = navigator.mediaDevices as CaptureDevices | undefined;
  return !!(devices?.getDisplayMedia && devices.setCaptureHandleConfig);
}
export function clipCaptureRect(rect: CaptureRect, bounds: {width:number;height:number}): CaptureRect {
  if (![rect.x,rect.y,rect.width,rect.height,bounds.width,bounds.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) throw new CaptureError('geometry');
  const x = Math.max(0,rect.x), y = Math.max(0,rect.y);
  const width = Math.min(bounds.width,rect.x+rect.width)-x, height = Math.min(bounds.height,rect.y+rect.height)-y;
  if (width < 1 || height < 1) throw new CaptureError('geometry');
  return {x,y,width,height};
}
/** Bounded waits, including encoders and browser promises that can otherwise hang. */
async function bounded<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new CaptureError('timeout')),ms);})]); }
  finally { clearTimeout(timer!); }
}
function observeFrame(video: HTMLVideoElement, accept: () => boolean = () => true) {
  let callback = 0;
  let timer: ReturnType<typeof setTimeout>;
  const cancel = () => {clearTimeout(timer);video.cancelVideoFrameCallback(callback);};
  const promise = new Promise<void>((resolve,reject)=>{
    timer=setTimeout(()=>{cancel();reject(new CaptureError('timeout'));},5000);
    const next: VideoFrameRequestCallback = () => {
      if(accept()){cancel();resolve();}
      else callback=video.requestVideoFrameCallback(next);
    };
    callback=video.requestVideoFrameCallback(next);
  });
  // The initiating browser operation may fail before this promise is awaited.
  void promise.catch(()=>{});
  return {promise,cancel};
}
/** Call directly in the initiating gesture. No import, timer or await before getDisplayMedia. */
export async function beginCapture(): Promise<CaptureSession> {
  if (!captureAvailable()) throw new CaptureError('unsupported');
  const devices=navigator.mediaDevices as CaptureDevices;
  handle ??= crypto.randomUUID();
  devices.setCaptureHandleConfig!({handle,permittedOrigins:[location.origin],exposeOrigin:false});
  const requested=devices.getDisplayMedia({audio:false,video:{frameRate:30},preferCurrentTab:true} as DisplayMediaStreamOptions);
  let timedOut=false;
  void requested.then(stream=>{if(timedOut)stream.getTracks().forEach(track=>track.stop());},()=>{});
  let stream: MediaStream;
  try { stream=await bounded(requested,120000); }
  catch(error) { timedOut=true;if(error instanceof DOMException && error.name==='NotAllowedError')throw new CaptureError('cancelled');throw error; }
  const track=stream.getVideoTracks()[0] as CaptureTrack | undefined;
  const verified=()=>track?.getSettings().displaySurface==='browser' && track.getCaptureHandle?.()?.handle===handle;
  if(!track || !verified()){stream.getTracks().forEach(t=>t.stop());throw new CaptureError('wrong-source');}
  const video=document.createElement('video');
  video.muted=true;video.playsInline=true;video.srcObject=stream;
  let disposed=false, taking=false;
  let target: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const dispose=()=>{
    if(disposed)return;disposed=true;clearTimeout(timer);
    stream.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;target?.remove();
    window.removeEventListener('pagehide',dispose);track.removeEventListener('ended',dispose);track.removeEventListener('capturehandlechange',dispose);
  };
  window.addEventListener('pagehide',dispose);track.addEventListener('ended',dispose);track.addEventListener('capturehandlechange',dispose);
  timer=setTimeout(dispose,120000);
  const initialFrame=observeFrame(video);
  try {await bounded(video.play());await initialFrame.promise;}
  catch(error){dispose();throw error;}
  finally{initialFrame.cancel();}
  return {dispose,async capture(input){
    if(disposed || taking)throw new CaptureError('ended');taking=true;
    const bounds=viewport();
    let rect:CaptureRect;
    try{rect=clipCaptureRect(input,bounds);}catch(error){dispose();throw error;}
    const scroll={x:window.scrollX,y:window.scrollY};
    let moved=false;
    const invalidate=()=>{moved=true;};
    window.addEventListener('scroll',invalidate,true);window.addEventListener('resize',invalidate);
    try {
      if(!verified())throw new CaptureError('wrong-source');
      const crop=(globalThis as typeof globalThis & {CropTarget?:{fromElement(element:Element):Promise<unknown>}}).CropTarget;
      const method=crop && track.cropTo ? 'region' : 'canvas';
      if(method==='region'){
        target=document.createElement('div');
        Object.assign(target.style,{position:'fixed',left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`,pointerEvents:'none',background:'transparent'});
        document.body.appendChild(target);
        const cropTarget=await bounded(crop!.fromElement(target));
        // A static tab may present its only cropped frame before cropTo resolves.
        // Subscribe first, and ignore any full-tab frames still in flight.
        const croppedFrame=observeFrame(video,()=>Math.abs(video.videoWidth/video.videoHeight/(rect.width/rect.height)-1)<=.015);
        try{await bounded(track.cropTo!(cropTarget));await croppedFrame.promise;}
        finally{croppedFrame.cancel();}
      }else{
        const freshFrame=observeFrame(video);
        try{await freshFrame.promise;}finally{freshFrame.cancel();}
      }
      if(disposed || track.readyState==='ended')throw new CaptureError('ended');
      if(!verified())throw new CaptureError('wrong-source');
      if(moved || bounds.width!==innerWidth || bounds.height!==innerHeight || scroll.x!==scrollX || scroll.y!==scrollY)throw new CaptureError('geometry');
      const vw=video.videoWidth,vh=video.videoHeight;
      if(!vw || !vh)throw new CaptureError('geometry');
      const expected=method==='region'?rect.width/rect.height:bounds.width/bounds.height;
      if(Math.abs(vw/vh/expected-1)>.015)throw new CaptureError('geometry');
      const source=method==='region'?{x:0,y:0,width:vw,height:vh}:{x:rect.x*vw/bounds.width,y:rect.y*vh/bounds.height,width:rect.width*vw/bounds.width,height:rect.height*vh/bounds.height};
      const scale=Math.min(1,2048/Math.max(source.width,source.height),Math.sqrt(4000000/(source.width*source.height)));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw new CaptureError('unsupported');
      ctx.drawImage(video,source.x,source.y,source.width,source.height,0,0,canvas.width,canvas.height);
      const blob=await bounded(new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new CaptureError('geometry')),'image/png')));
      return {blob,width:canvas.width,height:canvas.height,rect,viewport:bounds,capturedAt:new Date().toISOString(),method};
    } finally {window.removeEventListener('scroll',invalidate,true);window.removeEventListener('resize',invalidate);dispose();}
  }};
}

export {CaptureError} from "./contract";
