import {useEffect,useRef,useState,type PointerEvent} from 'react';
import type {CapturedImage} from '@/lib/capture/contract';
import {COMMENT_IMAGE_LIMITS,type BrushStroke} from '../../contracts/src/comment-image';
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
 return <dialog ref={dialog} aria-label="Draw on screenshot" onCancel={event=>{event.preventDefault();onCancel();}} className="m-auto max-h-[90vh] w-[min(900px,95vw)] overflow-auto rounded-lg border border-edge bg-panel p-4 text-fg shadow-xl backdrop:bg-black/50" onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='z'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();undo();}}}>
  <div className="mb-3 flex flex-wrap items-center gap-3">
   <h2 className="mr-auto font-semibold">Draw on screenshot</h2>
   <label className="text-xs">Color <input aria-label="Brush color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
   <label className="text-xs">Thickness <input aria-label="Brush thickness" type="range" min="1" max="16" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
   <button type="button" disabled={!count||busy} onClick={undo} aria-label="Undo stroke">Undo</button>
  </div>
  <canvas ref={canvas} width={image.width} height={image.height} aria-label="Screenshot drawing canvas" className="block h-auto max-w-full touch-none" style={{cursor:'crosshair',width:`min(100%, ${image.width/image.height*65}vh, ${image.width}px)`}}
   onPointerDown={event=>{if(!ready||busy||event.button!==0||active.current)return;event.preventDefault();if(strokes.current.length>=COMMENT_IMAGE_LIMITS.strokes){setError('Drawing limit reached. Undo a stroke to continue.');return;}event.currentTarget.setPointerCapture(event.pointerId);const scale=image.width/event.currentTarget.getBoundingClientRect().width;const stroke:BrushStroke={color,width:Math.min(128,width*scale),points:[point(event)]};active.current=stroke;strokes.current.push(stroke);setCount(strokes.current.length);schedule();}}
   onPointerMove={event=>{if(!active.current)return;if(strokes.current.reduce((sum,s)=>sum+s.points.length,0)>=COMMENT_IMAGE_LIMITS.points){finish();setError('Drawing limit reached. Undo a stroke to continue.');return;}active.current.points.push(point(event));schedule();}}
   onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/>
  {error&&<p role="alert" className="mt-2 text-danger">{error}</p>}
  <div className="mt-3 flex justify-end gap-4"><button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel drawing">Cancel</button><button type="button" onClick={()=>void save()} disabled={!ready||busy}>Done drawing</button></div>
 </dialog>;
}
