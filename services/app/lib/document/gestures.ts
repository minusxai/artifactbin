import {canvasResize} from './canvas-resize';
/** Transient gesture ink lives outside the editable document and never enters JSONB. */
import {Plugin,NodeSelection} from 'prosemirror-state';
import {dropPoint} from 'prosemirror-transform';
import type {EditorView} from 'prosemirror-view';
export function insertionLine(rect:{left:number;right:number;top:number;bottom:number},after:boolean){return {left:rect.left,top:after?rect.bottom:rect.top,width:Math.max(0,rect.right-rect.left)};}
export function resizeGuides(view:EditorView){
 const layer=document.createElement('div');layer.className='mdx-gesture-guides';layer.setAttribute('aria-hidden','true');document.body.append(layer);
 const vertical=document.createElement('i'),horizontal=document.createElement('i');layer.append(vertical,horizontal);view.dom.classList.add('mdx-gesture-active');
 return {update(rect:DOMRect){const page=view.dom.getBoundingClientRect(),toolbar=view.dom.closest('.mdx-editor-shell')?.querySelector('.mdx-toolbar')?.getBoundingClientRect().bottom??0,top=Math.max(toolbar,page.top,0);Object.assign(vertical.style,{left:`${rect.right}px`,top:`${top}px`,height:`${Math.max(0,rect.bottom-top)}px`,width:'1px'});Object.assign(horizontal.style,{left:`${page.left}px`,top:`${rect.bottom}px`,width:`${page.width}px`,height:'1px'});},clear(){layer.remove();view.dom.classList.remove('mdx-gesture-active');}};
}
export function documentGestures(){return new Plugin({view(view){
 const sizing=view.state.doc.attrs.props.layout==='canvas'?canvasResize(view):null;
 const marker=document.createElement('div');marker.className='mdx-drop-marker';marker.hidden=true;marker.setAttribute('aria-hidden','true');document.body.append(marker);
 const grip=document.createElement('button');grip.type='button';grip.className='mdx-block-grip';grip.setAttribute('aria-label','Select block');grip.textContent='⠿';grip.draggable=true;grip.hidden=true;document.body.append(grip);
 let hoverPos:number|null=null;
 function clear(){marker.hidden=true;view.dom.classList.remove('mdx-dragging');}
 function hover(event:MouseEvent){
  if(!view.editable||view.dragging)return;
  const target=(event.target as Element).closest?.('[data-node-id]');
  if(!target||!view.dom.contains(target)||target.classList.contains('mdx-container')||target.classList.contains('mdx-component')){grip.hidden=true;return;}
  const pos=view.posAtDOM(target,0),resolved=view.state.doc.resolve(pos);hoverPos=resolved.depth?resolved.before():null;
  if(hoverPos===null)return;const rect=target.getBoundingClientRect();grip.hidden=false;Object.assign(grip.style,{left:`${rect.left-25}px`,top:`${rect.top}px`});
 }
 grip.onmousedown=()=>{if(hoverPos!==null)view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,hoverPos)));};
 grip.ondragstart=event=>{
  if(!(view.state.selection instanceof NodeSelection)||!event.dataTransfer)return;
  // Native PM dragging can originate outside its DOM (the floating handle).
  const slice=view.state.selection.content();view.dragging={slice,move:true};event.dataTransfer.setData('text/plain',view.state.selection.node.textContent);event.dataTransfer.effectAllowed='move';
  const dom=view.nodeDOM(view.state.selection.from);if(dom instanceof Element)event.dataTransfer.setDragImage(dom,0,0);view.dom.classList.add('mdx-dragging');
 };
 function over(event:DragEvent){
  if(!view.editable||!view.dragging)return;view.dom.classList.add('mdx-dragging');grip.hidden=true;
  const found=view.posAtCoords({left:event.clientX,top:event.clientY});if(!found){marker.hidden=true;return;}
  const pos=dropPoint(view.state.doc,found.pos,view.dragging.slice);if(pos===null){marker.hidden=true;return;}
  const selection=view.state.selection;if(selection instanceof NodeSelection&&pos>=selection.from&&pos<=selection.to){marker.hidden=true;return;}
  const resolved=view.state.doc.resolve(pos);const before=resolved.nodeBefore,after=resolved.nodeAfter;
  const neighbor=after?view.nodeDOM(pos):before?view.nodeDOM(pos-before.nodeSize):null;
  let line:{left:number;top:number;width:number};
  if(neighbor instanceof Element)line=insertionLine(neighbor.getBoundingClientRect(),!after);
  else {const coords=view.coordsAtPos(pos);const parent=resolved.depth?view.nodeDOM(resolved.before()):view.dom;const box=(parent instanceof Element?parent:view.dom).getBoundingClientRect();line={left:box.left,top:coords.top,width:box.width};}
  marker.hidden=false;Object.assign(marker.style,{left:`${line.left}px`,top:`${line.top}px`,width:`${line.width}px`});
 }
 view.dom.addEventListener('mousemove',hover);view.dom.addEventListener('dragover',over);document.addEventListener('drop',clear);document.addEventListener('dragend',clear);
 const hide=()=>{grip.hidden=true;};window.addEventListener('scroll',hide,true);
 return {update(){sizing?.update();},destroy(){sizing?.destroy();marker.remove();grip.remove();view.dom.removeEventListener('mousemove',hover);view.dom.removeEventListener('dragover',over);document.removeEventListener('drop',clear);document.removeEventListener('dragend',clear);window.removeEventListener('scroll',hide,true);}};
 }});}
