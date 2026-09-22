import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {Brush,Check,Undo2,X,LoaderCircle} from 'lucide-react';
import {Tooltip} from './Tooltip';
import type {CapturedImage} from '@/lib/capture/contract';
import {COMMENT_IMAGE_LIMITS,type BrushStroke} from '../../contracts/src/comment-image';
const COLORS=[['Red','#ef4444'],['Orange','#f59e0b'],['Blue','#3b82f6'],['Green','#22c55e'],['Black','#171717'],['White','#ffffff']] as const;
export interface ScreenshotEditorProps {image:CapturedImage;initialStrokes:BrushStroke[];onDone:(preview:Blob,strokes:BrushStroke[])=>void;onCancel:()=>void}
/** Static image plus bounded vector strokes: undo never retains full pixel snapshots. */
export default function ScreenshotEditor({image,initialStrokes,onDone,onCancel}:ScreenshotEditorProps){
 const canvas=useRef<HTMLCanvasElement>(null),dialog=useRef<HTMLDialogElement>(null),bitmap=useRef<HTMLImageElement|null>(null);
 const strokes=useRef<BrushStroke[]>(structuredClone(initialStrokes)),active=useRef<BrushStroke|null>(null),raf=useRef(0);
 const [count,setCount]=useState(initialStrokes.length),[color,setColor]=useState('#ef4444'),[width,setWidth]=useState(3),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const paint=()=>{
  const ctx=canvas.current?.getContext('2d');if(!ctx||!bitmap.current)return;
  ctx.clearRect(0,0,image.width,image.height);ctx.drawImage(bitmap.current,0,0,image.width,image.height);
  for(const stroke of strokes.current){
   ctx.strokeStyle=stroke.color;ctx.fillStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';
   ctx.beginPath();const [first,...rest]=stroke.points;if(!first)continue;
   if(!rest.length){ctx.arc(first[0],first[1],stroke.width/2,0,Math.PI*2);ctx.fill();continue;}
   ctx.moveTo(...first);for(const point of rest)ctx.lineTo(...point);ctx.stroke();
  }
 };
 const schedule=()=>{if(!raf.current)raf.current=requestAnimationFrame(()=>{raf.current=0;paint();});};
 useEffect(()=>{
  dialog.current?.showModal?.();
  const url=URL.createObjectURL(image.blob),img=new Image();let live=true;
  img.onload=()=>{if(live){bitmap.current=img;paint();setReady(true);}};
  img.onerror=()=>{if(live)setError('Could not load the screenshot.');};img.src=url;
  return ()=>{live=false;URL.revokeObjectURL(url);cancelAnimationFrame(raf.current);bitmap.current=null;};
 },[image]);
 const point=(event:PointerEvent<HTMLCanvasElement>):[number,number]=>{
  const rect=event.currentTarget.getBoundingClientRect();
  return [Math.max(0,Math.min(image.width,(event.clientX-rect.left)*image.width/rect.width)),Math.max(0,Math.min(image.height,(event.clientY-rect.top)*image.height/rect.height))];
 };
 const undo=()=>{active.current=null;strokes.current.pop();setCount(strokes.current.length);schedule();};
 const finish=()=>{active.current=null;};
 const save=async()=>{
  if(!ready||!canvas.current)return;setBusy(true);setError('');finish();paint();
  try{const blob=await new Promise<Blob|null>(resolve=>canvas.current!.toBlob(resolve,'image/png'));if(!blob)throw new Error();onDone(blob,structuredClone(strokes.current));}
  catch{setError('Could not save the drawing. Please try again.');}finally{setBusy(false);}
 };
 return <dialog ref={dialog} aria-label="Draw on screenshot" onCancel={event=>{event.preventDefault();onCancel();}} className="m-auto max-h-[94dvh] w-[min(960px,calc(100vw-24px))] overflow-auto rounded-2xl border border-edge bg-panel p-0 font-sans text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm" onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='z'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();undo();}}}>
  <header className="flex items-start gap-3 px-5 py-4 sm:px-6">
   <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Brush size={20}/></span>
   <div className="min-w-0 flex-1"><h2 className="text-base font-semibold tracking-tight">Mark up your screenshot</h2><p className="mt-1 text-sm text-muted">Draw attention to the details that matter.</p></div>
   <Tooltip content="Close"><button type="button" aria-label="Cancel drawing" onClick={onCancel} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"><X size={18}/></button></Tooltip>
  </header>
  <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-edge px-5 py-3 sm:px-6">
   <div className="flex items-center gap-2" role="group" aria-label="Brush colors">
    {COLORS.map(([name,value])=><Tooltip key={name} content={name}><button type="button" aria-label={`${name} brush`} aria-pressed={color===value} onClick={()=>setColor(value)} className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${color===value?'ring-2 ring-fg ring-offset-2 ring-offset-panel':'border-black/15'}`} style={{backgroundColor:value,color:name==='White'?'#171717':'#ffffff'}}>{color===value&&<Check size={14} strokeWidth={3}/>}</button></Tooltip>)}
    <label className="ml-1 flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-edge" aria-label="Custom brush color"><input aria-label="Brush color" type="color" value={color} onChange={e=>setColor(e.target.value)} className="h-7 w-7 cursor-pointer border-0 bg-transparent p-0"/></label>
   </div>
   <label className="flex items-center gap-3 text-xs text-muted"><span>Size</span><input aria-label="Brush thickness" type="range" min="1" max="16" value={width} onChange={e=>setWidth(Number(e.target.value))} className="w-24 accent-accent"/><span className="w-9 tabular-nums text-fg">{width} px</span></label>
   <Tooltip content="Undo last stroke (⌘/Ctrl Z)"><button type="button" disabled={!count||busy} onClick={undo} aria-label="Undo stroke" className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium hover:bg-surface disabled:opacity-35"><Undo2 size={16}/>Undo</button></Tooltip>
  </div>
  <div className="flex min-h-64 items-center justify-center overflow-auto bg-surface p-5 sm:p-8" style={{backgroundImage:'radial-gradient(var(--color-edge, #d4d4d4) 1px, transparent 1px)',backgroundSize:'16px 16px'}}>
  <canvas ref={canvas} width={image.width} height={image.height} aria-label="Screenshot drawing canvas" className="block h-auto max-w-full touch-none rounded-sm bg-white shadow-lg" style={{cursor:'crosshair',width:`min(100%, ${image.width/image.height*52}vh, ${image.width}px)`}}
   onPointerDown={event=>{if(!ready||busy||event.button!==0||active.current)return;event.preventDefault();if(strokes.current.length>=COMMENT_IMAGE_LIMITS.strokes){setError('Drawing limit reached. Undo a stroke to continue.');return;}event.currentTarget.setPointerCapture(event.pointerId);const scale=image.width/event.currentTarget.getBoundingClientRect().width;const stroke:BrushStroke={color,width:Math.min(128,width*scale),points:[point(event)]};active.current=stroke;strokes.current.push(stroke);setCount(strokes.current.length);schedule();}}
   onPointerMove={event=>{if(!active.current)return;if(strokes.current.reduce((sum,s)=>sum+s.points.length,0)>=COMMENT_IMAGE_LIMITS.points){finish();setError('Drawing limit reached. Undo a stroke to continue.');return;}active.current.points.push(point(event));schedule();}}
   onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/>
  </div>
  {error&&<p role="alert" className="border-t border-edge px-6 py-3 text-sm text-danger">{error}</p>}
  <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-edge px-5 py-4 sm:px-6">
   <p className="mr-auto text-xs text-muted">{ready?'Your screenshot will be attached to the comment.':'Loading screenshot…'}</p>
   <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-surface hover:text-fg">Cancel</button>
   <button type="button" onClick={()=>void save()} disabled={!ready||busy} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg shadow-sm hover:brightness-110 disabled:opacity-40">{busy?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>}Use screenshot</button>
  </footer>
 </dialog>;
}
