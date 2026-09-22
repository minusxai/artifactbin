import {useEffect,useRef,useState} from 'react';
import type {CommentImageWire} from '../../contracts/src/comment-image';
export function BlobImage({blob,...props}:{blob:Blob;alt:string;className?:string}){
 const [url,setUrl]=useState('');useEffect(()=>{const value=URL.createObjectURL(blob);setUrl(value);return ()=>URL.revokeObjectURL(value);},[blob]);
 return url?<img src={url} {...props}/>:null;
}
export default function CommentScreenshot({image}:{image:CommentImageWire}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
 return <div className="mt-2">
  <button type="button" aria-label="Open comment screenshot" onClick={()=>{setOpen(true);dialog.current?.showModal();}} className="block w-full overflow-hidden rounded border border-edge">
   <img src={image.thumbnailUrl} width={image.width} height={image.height} loading="lazy" alt="Screenshot attached to comment" className="h-auto max-h-48 w-full object-contain"/>
  </button>
  <dialog ref={dialog} aria-label="Comment screenshot" onClose={()=>setOpen(false)} className="m-auto max-h-[90vh] max-w-[95vw] overflow-auto rounded-lg bg-panel p-4 text-fg backdrop:bg-black/50">
   <div className="mb-3 flex justify-between gap-6"><span>Screenshot · {new Date(image.capturedAt).toLocaleString()}</span><button type="button" onClick={()=>dialog.current?.close()}>Close screenshot</button></div>
   {open&&<a href={image.previewUrl} target="_blank" rel="noreferrer" aria-label="Open screenshot at full size"><img src={image.previewUrl} width={image.width} height={image.height} alt="Full comment screenshot" className="h-auto max-w-full"/></a>}
  </dialog>
 </div>;
}
