import {useEffect,useRef,useState} from 'react';
import {Image as ImageIcon,ArrowUpRight,X} from 'lucide-react';
import type {CommentImageWire} from '../../contracts/src/comment-image';
export function BlobImage({blob,...props}:{blob:Blob;alt:string;className?:string}){
 const [url,setUrl]=useState('');useEffect(()=>{const value=URL.createObjectURL(blob);setUrl(value);return ()=>URL.revokeObjectURL(value);},[blob]);
 return url?<img src={url} {...props}/>:null;
}
export default function CommentScreenshot({image}:{image:CommentImageWire}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
 return <div className="mt-2">
  <button type="button" aria-label="Open comment screenshot" onClick={()=>{setOpen(true);dialog.current?.showModal();}} className="group block w-full overflow-hidden rounded-lg border border-edge bg-surface text-left transition-colors hover:border-accent/50">
   <img src={image.thumbnailUrl} width={image.width} height={image.height} loading="lazy" alt="Screenshot attached to comment" className="h-auto max-h-48 w-full object-contain"/><span className="flex items-center gap-2 border-t border-edge px-3 py-2 text-xs font-medium text-muted group-hover:text-fg"><ImageIcon size={13}/>Screenshot<ArrowUpRight size={13} className="ml-auto"/></span>
  </button>
  <dialog ref={dialog} aria-label="Comment screenshot" onClose={()=>setOpen(false)} className="m-auto max-h-[94dvh] w-[min(1100px,calc(100vw-24px))] overflow-auto rounded-2xl border border-edge bg-panel p-0 font-sans text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
   <header className="flex items-center gap-3 border-b border-edge px-5 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted"><ImageIcon size={18}/></span><div className="flex-1"><h2 className="text-sm font-semibold">Comment screenshot</h2><p className="mt-0.5 text-xs text-muted">{new Date(image.capturedAt).toLocaleString()}</p></div><button type="button" aria-label="Close screenshot" onClick={()=>dialog.current?.close()} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg"><X size={18}/></button></header>
   {open&&<div className="flex justify-center bg-surface p-5 sm:p-8"><img src={image.previewUrl} width={image.width} height={image.height} alt="Full comment screenshot" className="h-auto max-h-[68dvh] max-w-full rounded-sm object-contain shadow-lg"/></div>}
   <footer className="flex justify-end border-t border-edge px-5 py-3"><a href={image.previewUrl} target="_blank" rel="noreferrer" aria-label="Open screenshot at full size" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft">Open full size<ArrowUpRight size={14}/></a></footer>
  </dialog>
 </div>;
}
