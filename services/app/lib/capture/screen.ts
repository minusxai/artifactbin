import {CaptureError, type CaptureRect, type CaptureSession, type CaptureStage} from './contract';

interface CaptureTrack extends MediaStreamTrack {
  getCaptureHandle?: () => {handle?: string} | null;
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
async function bounded<T>(promise: Promise<T>, stage: CaptureStage, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const started=performance.now();let outcome='success';
  try { return await Promise.race([promise, new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new CaptureError('timeout',stage)),ms);})]); }
  catch(error){outcome='error';throw error;}
  finally { clearTimeout(timer!);const name=`comment-screenshot:${stage}`;performance.clearMeasures(name);performance.measure(name,{start:started,end:performance.now(),detail:{outcome}}); }
}
function observeFrame(video: HTMLVideoElement, stage: CaptureStage, accept: () => boolean = () => true) {
  let callback = 0;const started=performance.now();let frames=0;
  const record=(outcome:string)=>{const name=`comment-screenshot:${stage}`;performance.clearMeasures(name);performance.measure(name,{start:started,end:performance.now(),detail:{outcome,frames,width:video.videoWidth,height:video.videoHeight}});};
  let timer: ReturnType<typeof setTimeout>;
  const cancel = () => {clearTimeout(timer);video.cancelVideoFrameCallback(callback);};
  const promise = new Promise<void>((resolve,reject)=>{
    timer=setTimeout(()=>{record('timeout');cancel();reject(new CaptureError('timeout',stage));},5000);
    const next: VideoFrameRequestCallback = () => {
      frames++;if(accept()){record('success');cancel();resolve();}
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
  try { stream=await bounded(requested,'permission',600000); }
  catch(error) { timedOut=true;if(error instanceof DOMException && error.name==='NotAllowedError')throw new CaptureError('cancelled');throw error; }
  const track=stream.getVideoTracks()[0] as CaptureTrack | undefined;
  const verified=()=>track?.getSettings().displaySurface==='browser' && track.getCaptureHandle?.()?.handle===handle;
  if(!track || !verified()){stream.getTracks().forEach(t=>t.stop());throw new CaptureError('wrong-source');}
  // Read a fresh full-tab bitmap directly when available. Native region crops
  // stalled frame delivery in real Chrome probes, so crop still images locally.
  const ImageCaptureClass=(globalThis as unknown as {ImageCapture?:new(track:MediaStreamTrack)=>{grabFrame():Promise<ImageBitmap>}}).ImageCapture;
  let grabber: {grabFrame():Promise<ImageBitmap>}|null;
  try{grabber=ImageCaptureClass?new ImageCaptureClass(track):null;}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
  const video=grabber?null:document.createElement('video');
  if(video){video.muted=true;video.playsInline=true;video.srcObject=stream;}
  let disposed=false, taking=false;
  let timer: ReturnType<typeof setTimeout>;
  const dispose=()=>{
    if(disposed)return;disposed=true;clearTimeout(timer);
    stream.getTracks().forEach(t=>t.stop());if(video){video.pause();video.srcObject=null;}
    window.removeEventListener('pagehide',dispose);track.removeEventListener('ended',dispose);track.removeEventListener('capturehandlechange',dispose);
  };
  window.addEventListener('pagehide',dispose);track.addEventListener('ended',dispose);track.addEventListener('capturehandlechange',dispose);
  timer=setTimeout(dispose,120000);
  if(video){
  const initialFrame=observeFrame(video,'initial-frame');
  try {await bounded(video.play(),'playback');await initialFrame.promise;}
  catch(error){dispose();throw error;}
  finally{initialFrame.cancel();}
  }
  return {dispose,async capture(input){
    if(disposed || taking)throw new CaptureError('ended');taking=true;
    const bounds=viewport();
    let rect:CaptureRect;
    try{rect=clipCaptureRect(input,bounds);}catch(error){dispose();throw error;}
    const scroll={x:window.scrollX,y:window.scrollY};
    let bitmap:ImageBitmap|undefined;
    let moved=false;
    const invalidate=()=>{moved=true;};
    const resize=()=>{if(bounds.width!==innerWidth||bounds.height!==innerHeight)moved=true;};
    window.addEventListener('scroll',invalidate,true);window.addEventListener('resize',resize);
    try {
      if(!verified())throw new CaptureError('wrong-source');
      // Let selection chrome removal reach a paint before asking for the next frame.
      await bounded(new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))),'paint');
      if(disposed)throw new CaptureError('ended');
      if(grabber){
        // Drain one queued pre-paint frame, then read the next delivery. Both reads
        // share one deadline. Every bitmap is released, including late results.
        let expired=false;
        const pending=(async()=>{
          const warmup=await grabber.grabFrame();warmup.close();
          if(expired||disposed)throw new CaptureError(expired?'timeout':'ended','track-frame');
          const next=await grabber.grabFrame();
          if(expired){next.close();throw new CaptureError('timeout','track-frame');}
          return next;
        })();
        void pending.catch(()=>{});
        try{bitmap=await bounded(pending,'track-frame');}catch(error){expired=true;throw error;}
      }else if(video){
        const freshFrame=observeFrame(video,'full-frame');
        try{await freshFrame.promise;}finally{freshFrame.cancel();}
      }
      if(disposed || track.readyState==='ended')throw new CaptureError('ended');
      if(!verified())throw new CaptureError('wrong-source');
      if(moved || bounds.width!==innerWidth || bounds.height!==innerHeight || scroll.x!==scrollX || scroll.y!==scrollY)throw new CaptureError('geometry');
      const vw=bitmap?.width??video!.videoWidth,vh=bitmap?.height??video!.videoHeight;
      if(!vw || !vh)throw new CaptureError('geometry');
      const expected=bounds.width/bounds.height;
      if(Math.abs(vw/vh/expected-1)>.015)throw new CaptureError('geometry');
      const source={x:rect.x*vw/bounds.width,y:rect.y*vh/bounds.height,width:rect.width*vw/bounds.width,height:rect.height*vh/bounds.height};
      const scale=Math.min(1,2048/Math.max(source.width,source.height),Math.sqrt(4000000/(source.width*source.height)));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw new CaptureError('unsupported');
      ctx.drawImage(bitmap??video!,source.x,source.y,source.width,source.height,0,0,canvas.width,canvas.height);
      const blob=await bounded(new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new CaptureError('geometry')),'image/png')),'encode');
      return {blob,width:canvas.width,height:canvas.height,rect,viewport:bounds,capturedAt:new Date().toISOString(),method:'canvas'};
    } finally {bitmap?.close();window.removeEventListener('scroll',invalidate,true);window.removeEventListener('resize',resize);dispose();}
  }};
}

export {CaptureError} from "./contract";
