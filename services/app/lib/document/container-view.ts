import {resizeGuides} from './gestures';
/** Layout chrome follows physical boundaries; the content slot remains owned by ProseMirror. */
import {NodeSelection} from 'prosemirror-state';
import type {Node as PmNode} from 'prosemirror-model';
import type {EditorView,NodeView} from 'prosemirror-view';
import {dividerPosition,flexRatios,resizeFlexRatios,widthPercentage} from '../story-ui/flex-layout';
import {dimensionPreview,nodeParentExtent,setDocumentNodeProps} from './editor-layout';

export function containerNodeView(node:PmNode,view:EditorView,getPos:()=>number|undefined,editable:()=>boolean):NodeView{
 const dom=document.createElement('div'),contentDOM=document.createElement('div'),controls=document.createElement('div');
 dom.className='mdx-container';contentDOM.className='mdx-container-content';controls.className='mdx-container-controls';controls.contentEditable='false';dom.append(contentDOM,controls);
 let current=node,destroyed=false,frame=0,isSelected=false;
 const dividers=document.createElement('div');dividers.className='mdx-layout-dividers';dividers.hidden=true;
 const sheet=document.createElement('style'),feedback=document.createElement('output');feedback.className='mdx-size-feedback';feedback.hidden=true;
 let handles:HTMLButtonElement[]=[];
 function button(label:string,className:string,text=''){const b=document.createElement('button');b.type='button';b.className=className;b.setAttribute('aria-label',label);b.textContent=text;controls.append(b);return b;}
 function selected(){const pos=getPos();if(pos!==undefined)view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,pos)));}
 function setSizes(sizes:number[]){const pos=getPos();if(pos===undefined||!editable())return;const tr=view.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,props:{...current.attrs.props,sizes}});tr.setSelection(NodeSelection.create(tr.doc,pos));view.dispatch(tr);}
 function layout(sizes:number[]){sheet.textContent=sizes.map((size,i)=>`.mdx-container[data-node-id="${current.attrs.id}"] > .mdx-container-content > :nth-child(${i+1}){flex:${size} 1 0;min-width:0}`).join('');position();}
 function position(){
  if(destroyed)return;const parent=dom.getBoundingClientRect(),slot=contentDOM.getBoundingClientRect(),column=current.attrs.props.direction==='column';
  handles.forEach((handle,i)=>{const a=contentDOM.children[i]?.getBoundingClientRect(),b=contentDOM.children[i+1]?.getBoundingClientRect();if(!a||!b)return;
   const boundary=column?dividerPosition({start:a.top,size:a.height},{start:b.top,size:b.height})-parent.top:dividerPosition({start:a.left,size:a.width},{start:b.left,size:b.width})-parent.left;
   Object.assign(handle.style,column?{left:`${slot.left-parent.left}px`,top:`${boundary-8}px`,width:`${slot.width}px`,height:'16px'}:{left:`${boundary-8}px`,top:`${slot.top-parent.top}px`,width:'16px',height:`${slot.height}px`});handle.dataset.direction=column?'column':'row';
  });
 }
 function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(position);}
 const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);observer?.observe(contentDOM);
 function resizeHandle(axis:'width'|'height'|'both'){
  const handle=button(axis==='both'?'Resize container':`Resize container ${axis}`,`mdx-container-resize mdx-resize-${axis}`);
  handle.onpointerdown=event=>{
   if(!editable())return;event.preventDefault();event.stopPropagation();const pos=getPos();if(pos===undefined)return;
   const rect=dom.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,preview=dimensionPreview(view,pos,dom);let width=rect.width,height=rect.height;
   const guides=resizeGuides(view);handle.setPointerCapture(event.pointerId);feedback.hidden=false;dom.classList.add('mdx-resizing');
   const move=(e:PointerEvent)=>{width=Math.max(48,rect.width+(axis==='height'?0:e.clientX-startX));height=Math.max(32,rect.height+(axis==='width'?0:e.clientY-startY));preview.update(width,height);guides.update(dom.getBoundingClientRect());feedback.textContent=axis==='height'?`${Math.round(height)} px`:`${widthPercentage(width,nodeParentExtent(view,pos))}%${axis==='both'?` · ${Math.round(height)} px`:''}`;position();};
   const finish=(commit:boolean)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);preview.clear();guides.clear();feedback.hidden=true;dom.classList.remove('mdx-resizing');if(commit&&editable())setDocumentNodeProps(view,pos,{...(axis==='height'?{}:{width:Math.round(width)}),...(axis==='width'?{}:{height:Math.round(height)})});};
   const up=()=>finish(true),cancel=()=>finish(false);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',cancel);
  };
  handle.onkeydown=e=>{if(!editable()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const pos=getPos();if(pos===undefined)return;const rect=dom.getBoundingClientRect();setDocumentNodeProps(view,pos,{...(axis==='height'?{}:{width:Math.max(48,rect.width+(e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0))}),...(axis==='width'?{}:{height:Math.max(32,rect.height+(e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0))})});};
 }
 function draw(){
  if(destroyed)return;const props=current.attrs.props;dom.dataset.nodeId=current.attrs.id;dom.dataset.container=current.attrs.name??current.attrs.tag;
  dom.style.minHeight=typeof props.height==='number'?`${props.height}px`:'';dom.style.width=typeof props.width==='number'?`${props.width}px`:'';dom.style.cssFloat=['left','right'].includes(props.float)?props.float:'none';
  contentDOM.className=`mdx-container-content ${typeof props.className==='string'?props.className:''}`;
  contentDOM.style.minHeight=typeof props.height==='number'?`${Math.max(0,props.height)}px`:'';
  contentDOM.style.display=current.attrs.name==='Flex'?'flex':'block';contentDOM.style.flexDirection=props.direction==='column'?'column':'row';contentDOM.style.gap='16px';
  feedback.removeAttribute('style');controls.replaceChildren();controls.hidden=!editable();dividers.replaceChildren();dividers.hidden=!isSelected;handles=[];
  const grip=button(`Select ${current.attrs.name??'container'}`,'mdx-container-grip','⠿');grip.draggable=true;grip.onmousedown=selected;grip.onclick=e=>{if(e.detail===0)selected();};
  controls.append(dividers,sheet,feedback);resizeHandle('width');resizeHandle('height');resizeHandle('both');
  if(current.attrs.name!=='Flex')return;
  const sizes=flexRatios(props.sizes,current.childCount),column=props.direction==='column';
  for(let i=0;i<sizes.length-1;i++){
   const handle=document.createElement('button');handle.type='button';handle.className='mdx-layout-divider';handle.setAttribute('aria-label',`Resize layout divider ${i+1}`);dividers.append(handle);handles.push(handle);
   handle.onkeydown=e=>{if(!editable()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();setSizes(resizeFlexRatios(sizes,i,['ArrowRight','ArrowDown'].includes(e.key)?20:-20,column?contentDOM.clientHeight:contentDOM.clientWidth));};
   handle.onpointerdown=event=>{
    if(!editable())return;event.preventDefault();event.stopPropagation();const start=column?event.clientY:event.clientX,extent=column?contentDOM.clientHeight:contentDOM.clientWidth;let next=sizes.slice();const guides=resizeGuides(view);handle.setPointerCapture(event.pointerId);dom.classList.add('mdx-resizing');feedback.hidden=false;
    const move=(e:PointerEvent)=>{next=resizeFlexRatios(sizes,i,(column?e.clientY:e.clientX)-start,extent);layout(next);guides.update(contentDOM.children[i].getBoundingClientRect());const total=next.reduce((a,b)=>a+b,0);feedback.textContent=`${widthPercentage(next[i],total)}% / ${widthPercentage(next[i+1],total)}%`;Object.assign(feedback.style,{left:`${handle.offsetLeft+16}px`,top:`${handle.offsetTop}px`,right:'auto',bottom:'auto'});};
    const finish=(commit:boolean)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);feedback.hidden=true;guides.clear();dom.classList.remove('mdx-resizing');if(commit)setSizes(next);else layout(sizes);};
    const up=()=>finish(true),cancel=()=>finish(false);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',cancel);
   };
  }
  layout(sizes);schedule();
 }
 queueMicrotask(draw);
 return {dom,contentDOM,selectNode(){isSelected=true;dom.classList.add('ProseMirror-selectednode');dividers.hidden=false;},deselectNode(){isSelected=false;dom.classList.remove('ProseMirror-selectednode');dividers.hidden=true;},update(next){if(next.type!==current.type)return false;current=next;queueMicrotask(draw);return true;},ignoreMutation:m=>m.type!=='selection'&&(m.type==='attributes'&&(m.attributeName==='style'||m.target===contentDOM&&m.attributeName==='class')||!contentDOM.contains(m.target)),stopEvent:e=>!e.type.startsWith('drag')&&e.type!=='drop'&&controls.contains(e.target as Node),destroy(){destroyed=true;observer?.disconnect();cancelAnimationFrame(frame);}};
}
