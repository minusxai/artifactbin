import {useCallback,useEffect,useRef,useState} from 'react';
import {beginCapture,CaptureError} from './screen';
import type {CaptureSession,CapturedImage,CaptureRect} from './contract';
import type {BrushStroke,CommentImageMetadata} from '../../../contracts/src/comment-image';
export interface ScreenshotDraft {image:CapturedImage;preview:Blob;strokes:BrushStroke[];editId:string}
const messages:Record<string,string>={unsupported:'This browser cannot verify capture of this tab. Upload a screenshot, or explicitly continue without one.',cancelled:'Screen sharing was cancelled. Retry, upload a screenshot, or continue without one.', 'wrong-source':'Choose this browser tab when sharing. The other source was stopped.',geometry:'The page moved during capture. Retake the screenshot.',ended:'Screen sharing ended. Retake the screenshot.',timeout:'Capture timed out. Please retry.'};
/** Short-lived capture state belongs to one document, not to its live geometry echoes. */
export function useCommentCapture(id:string,editId:string|undefined){
 const session=useRef<CaptureSession|null>(null),generation=useRef(0),revision=useRef(editId);
 revision.current=editId;
 const staged=useRef<{draft:ScreenshotDraft;id:string}|null>(null);
 const [draft,setDraft]=useState<ScreenshotDraft|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[required,setRequired]=useState(false),[error,setError]=useState('');
 const reset=useCallback(()=>{generation.current++;session.current?.dispose();session.current=null;setDraft(null);setEditing(false);setBusy(false);setRequired(false);setError('');},[]);
 useEffect(()=>{reset();return ()=>{generation.current++;session.current?.dispose();};},[id,reset]);
 const start=async()=>{
  reset();if(!editId)return true;
  const mine=generation.current;setRequired(true);setBusy(true);
  // beginCapture enters the browser picker synchronously, before its first await.
  const pending=beginCapture();
  try{const next=await pending;if(mine!==generation.current){next.dispose();return false;}session.current=next;}
  catch(e){if(mine===generation.current)setError(messages[e instanceof CaptureError?e.code:'unsupported']);}
  finally{if(mine===generation.current)setBusy(false);}
  return mine===generation.current;
 };
 const capture=async(rect:CaptureRect)=>{
  if(!editId)return;setRequired(true);
  const current=session.current;session.current=null;
  if(!current){setError(value=>value||messages.unsupported);return;}
  const mine=generation.current,capturedEditId=revision.current!;setBusy(true);
  const started=performance.now();
  // Selection chrome is not part of the image. Global class is removed in every exit path.
  document.documentElement.classList.add('mx-taking-screenshot');
  try{const image=await current.capture(rect);if(mine!==generation.current)return;if(revision.current!==capturedEditId)throw new CaptureError('geometry');setDraft({image,preview:image.blob,strokes:[],editId:capturedEditId});setEditing(true);setError('');}
  catch(e){if(mine===generation.current)setError(messages[e instanceof CaptureError?e.code:'unsupported']);}
  finally{performance.measure('comment-screenshot:capture',{start:started,end:performance.now()});current.dispose();document.documentElement.classList.remove('mx-taking-screenshot');if(mine===generation.current)setBusy(false);}
 };
 const upload=async(file:File)=>{
  if(!editId)return;const mine=++generation.current;session.current?.dispose();session.current=null;setBusy(true);setError('');
  try{
   if(file.size>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Use a PNG, JPEG or WebP up to 8 MB.');
   const bitmap=await createImageBitmap(file);
   try{const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height),Math.sqrt(4000000/(bitmap.width*bitmap.height)));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/png'));if(!blob)throw new Error('Could not read this image.');const image:CapturedImage={blob,width:canvas.width,height:canvas.height,rect:{x:0,y:0,width:canvas.width,height:canvas.height},viewport:{width:canvas.width,height:canvas.height},method:'upload',capturedAt:new Date().toISOString()};if(mine!==generation.current)return;setDraft({image,preview:blob,strokes:[],editId});setRequired(true);setEditing(true);}finally{bitmap.close();}
  }catch(e){if(mine===generation.current)setError(e instanceof Error?e.message:'Could not read this image.');}finally{if(mine===generation.current)setBusy(false);}
 };
 const stage=async()=>{
  if(!draft)return undefined;
  if(staged.current?.draft===draft)return staged.current.id;
  const metadata:CommentImageMetadata={v:1,capturedEditId:draft.editId,capturedAt:draft.image.capturedAt,method:draft.image.method,width:draft.image.width,height:draft.image.height,rect:draft.image.rect,viewport:draft.image.viewport,strokes:draft.strokes};
  const form=new FormData();form.set('original',draft.image.blob,'original.png');form.set('preview',draft.preview,'preview.png');form.set('metadata',JSON.stringify(metadata));
  const response=await fetch(`/api/my/artifacts/${id}/comment-images`,{method:'POST',body:form});
  if(!response.ok){const result=await response.json();throw new Error(result.error==='stale'?'The document changed. Your draft is preserved; retake the screenshot.':result.error==='quota_exceeded'?'Image storage quota reached.':'Could not upload the screenshot. Please retry.');}
  const result=await response.json() as {id:string};staged.current={draft,id:result.id};return result.id;
 };
 return {draft,editing,busy,required,error,reset,start,capture,upload,stage,
  edit:()=>setEditing(true),cancelEdit:()=>setEditing(false),
  done:(preview:Blob,strokes:BrushStroke[])=>{setDraft(value=>value?{...value,preview,strokes}:null);setEditing(false);},
  skip:()=>{reset();},
 };
}
