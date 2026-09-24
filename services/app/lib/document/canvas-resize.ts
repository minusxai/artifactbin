/** Selected-node controls live outside author DOM, preserving its CSS child relationships. */
import {NodeSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {dimensionPreview,setDocumentNodeProps} from './editor-layout';

export function canvasResize(view:EditorView){
 const layer=document.createElement('div');layer.className='mdx-canvas-resize-controls';layer.hidden=true;document.body.append(layer);
 let resizing=false;
 function update(){
  if(resizing)return;
  const selection=view.state.selection,dom=selection instanceof NodeSelection?view.nodeDOM(selection.from):null;
  layer.hidden=!view.editable||!(selection instanceof NodeSelection)||!(dom instanceof HTMLElement)||selection.node.attrs.name==='Helmet';
  if(layer.hidden||!(dom instanceof HTMLElement))return;
  const rect=dom.getBoundingClientRect();Object.assign(layer.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
 }
 for(const axis of ['width','height','both'] as const){
  const handle=document.createElement('button');handle.className=`mdx-container-resize mdx-resize-${axis}`;handle.type='button';handle.setAttribute('aria-label',axis==='both'?'Resize selected block':`Resize selected block ${axis}`);layer.append(handle);
  handle.onpointerdown=event=>{
   if(!view.editable||!(view.state.selection instanceof NodeSelection))return;
   const pos=view.state.selection.from,dom=view.nodeDOM(pos);if(!(dom instanceof HTMLElement))return;
   event.preventDefault();const rect=dom.getBoundingClientRect(),scaleX=rect.width/(dom.offsetWidth||rect.width||1),scaleY=rect.height/(dom.offsetHeight||rect.height||1),x=event.clientX,y=event.clientY;
   let width=rect.width/scaleX,height=rect.height/scaleY;const preview=dimensionPreview(view,pos,dom);resizing=true;handle.setPointerCapture(event.pointerId);view.dom.classList.add('mdx-gesture-active');
   const move=(e:PointerEvent)=>{width=Math.max(24,rect.width/scaleX+(axis==='height'?0:(e.clientX-x)/scaleX));height=Math.max(24,rect.height/scaleY+(axis==='width'?0:(e.clientY-y)/scaleY));preview.update(width,height);const next=dom.getBoundingClientRect();layer.style.width=`${next.width}px`;layer.style.height=`${next.height}px`;};
   const finish=(commit:boolean)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);preview.clear();resizing=false;view.dom.classList.remove('mdx-gesture-active');if(commit)setDocumentNodeProps(view,pos,{...(axis==='height'?{}:{width:Math.round(width)}),...(axis==='width'?{}:{height:Math.round(height)})});update();};
   const up=()=>finish(true),cancel=()=>finish(false);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',cancel);
  };
 }
 window.addEventListener('scroll',update,true);window.addEventListener('resize',update);
 return {update,destroy(){window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);layer.remove();}};
}
