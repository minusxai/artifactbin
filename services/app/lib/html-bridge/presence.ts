import type {PresenceGeometry,PresencePaint} from '../html-presence/contract';
import {captureSelection,paintSelections} from './presence-selection';
import {PRESENCE_POINTER_THROTTLE_MS} from '../html-presence/model';
/** Owns only ephemeral geometry and inert overlays; no credentials, viewer storage or app state. */
export function startHtmlPresence(win:Window,publish:(geometry:PresenceGeometry)=>void){
 const doc=win.document,layer=doc.createElement('div');layer.setAttribute('data-af','presence-overlay');Object.assign(layer.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'2147483645'});doc.documentElement.append(layer);
 // Selections repaint wholesale; cursors persist per viewer, so a moved cursor glides across one publication window
 // instead of jumping, while a scroll or resize repaint (same geometry) follows the page without lag.
 const selections=doc.createElement('div'),cursors=new Map<string,{mark:HTMLElement;at:string}>();layer.append(selections);
 let input:PresencePaint|null=null,cursor:PresenceGeometry['cursor']=null;
 const safe=(element:Element)=>!element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,[hidden],[data-af-private],[data-af="presence-overlay"],[data-af="annotation-overlay"]');
 const target=(id:string)=>{const nodes=[...doc.querySelectorAll('[data-af-id]')].filter(node=>node.getAttribute('data-af-id')===id);return nodes.length===1&&safe(nodes[0]!)?nodes[0]!:null;};
 const emit=()=>publish({cursor,selection:captureSelection(doc)?.ranges??null});
 const paint=()=>{
  const viewers=input?.viewers??[],prefs=input?.preferences;
  paintSelections(selections,prefs?.showSelections?viewers.map(viewer=>({...viewer,actor:viewer.label,selection:viewer.selection?{ranges:viewer.selection}:null})):[]);
  const shown=new Set<string>();
  if(prefs?.showCursors)for(const viewer of viewers){const c=viewer.cursor,node=c&&target(c.nodeId);if(!node||!c)continue;const rect=node.getBoundingClientRect(),x=rect.x+rect.width*c.x,y=rect.y+rect.height*c.y;
   if(x<0||y<0||x>win.innerWidth||y>win.innerHeight)continue;
   shown.add(viewer.id);const at=`${c.nodeId}:${c.x}:${c.y}`;let cursor=cursors.get(viewer.id);
   if(!cursor){const mark=doc.createElement('div');mark.setAttribute('data-af-presence-cursor',viewer.id);Object.assign(mark.style,{position:'fixed',color:'#2563eb',font:'12px sans-serif',background:'white',borderRadius:'3px',padding:'2px',pointerEvents:'none',userSelect:'none'});layer.append(mark);cursor={mark,at};cursors.set(viewer.id,cursor);}
   const glide=cursor.at!==at;cursor.at=at;
   Object.assign(cursor.mark.style,{transition:glide?`left ${PRESENCE_POINTER_THROTTLE_MS}ms linear, top ${PRESENCE_POINTER_THROTTLE_MS}ms linear`:'none',left:`${x}px`,top:`${y}px`});
   const label=`↖ ${viewer.label}`;if(cursor.mark.textContent!==label)cursor.mark.textContent=label;
  }
  for(const [id,cursor] of cursors)if(!shown.has(id)){cursor.mark.remove();cursors.delete(id);}
 };
 const move=(event:PointerEvent)=>{const origin=event.target as Element;const node=origin?.closest?.('[data-af-id]');if(!node||!safe(origin)||!safe(node)||target(node.getAttribute('data-af-id')!)!==node){cursor=null;emit();return;}const rect=node.getBoundingClientRect();cursor=rect.width>0&&rect.height>0?{nodeId:node.getAttribute('data-af-id')!,x:Math.max(0,Math.min(1,(event.clientX-rect.x)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.y)/rect.height))}:null;emit();};
 const leave=()=>{cursor=null;emit();};
 const selection=()=>emit();
 doc.addEventListener('pointermove',move);doc.addEventListener('pointerleave',leave);doc.addEventListener('selectionchange',selection);win.addEventListener('scroll',paint,true);win.addEventListener('resize',paint);
 return {ownsOverlay:(node:Node)=>node===layer||layer.contains(node),receive:(next:PresencePaint)=>{input=next;paint();},paint,dispose:()=>{doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerleave',leave);doc.removeEventListener('selectionchange',selection);win.removeEventListener('scroll',paint,true);win.removeEventListener('resize',paint);layer.remove();}};
}
