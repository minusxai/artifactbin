import type {ReactNode} from 'react';
import MobileSheet,{useIsPhoneViewport} from './MobileSheet';

/** Shared settings/notification surface; its caller owns content and exclusive open state. */
export function PagePanel({open,label,onClose,header,children,rightOffset=12,panelTop,wide=false}:{
 open:boolean;label:string;onClose:()=>void;header:ReactNode;children:ReactNode;rightOffset?:number;panelTop?:number;wide?:boolean;
}){
 const phone=useIsPhoneViewport();
 if(!open)return null;
 return phone?<MobileSheet label={label} onClose={onClose} header={header}>{children}</MobileSheet>:<>
  <button type="button" aria-label={`Close ${label.toLowerCase()} by clicking outside`} onClick={onClose} className="fixed inset-x-0 bottom-0 top-11 z-40 cursor-default border-0 bg-transparent p-0"/>
  <aside role="dialog" aria-label={label} className={`fixed right-3 top-14 z-50 ${wide?'w-96':'w-72'} max-w-[calc(100vw-24px)] max-h-[80vh] overflow-auto animate-[rise_.14s_ease-out] rounded-[7px] border border-edge bg-surface p-3 font-mono text-xs shadow-xl`} style={{...(rightOffset===12?{}:{right:rightOffset}),...(panelTop!==undefined?{top:panelTop}:{})}}>
   {header}{children}
  </aside>
 </>;
}
