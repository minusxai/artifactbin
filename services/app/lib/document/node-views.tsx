/** DOM ownership boundary: editable slots belong to ProseMirror; component contents belong to React.
 * Layout styles live outside editable children so resizing never feeds back as text mutations.
 */
import {createRoot,type Root} from 'react-dom/client';
import {NodeSelection} from 'prosemirror-state';
import type {EditorView,NodeView} from 'prosemirror-view';
import type {Node as PmNode} from 'prosemirror-model';
import {flexRatios,resizeFlexRatios} from '../story-ui/flex-layout';
import {editorDocument} from './editor';
import {documentJsx} from './markup';
import {parseJsx} from '../jsx/parse';
import {StoryRuntimeApp} from '../story-runtime/StoryRuntimeApp';
import type {DataflowStore} from '../story-runtime/store';
export function documentNodeViews(store:DataflowStore,editable:()=>boolean){
  function componentView(node:PmNode,v:EditorView,getPos:()=>number|undefined):NodeView{
   const dom=window.document.createElement(node.isInline?'span':'div');dom.className='mdx-component';dom.contentEditable='false';
   const content=window.document.createElement(node.isInline?'span':'div');dom.append(content);let current=node;const root:Root=createRoot(content);
   const select=window.document.createElement('button');select.type='button';select.className='mdx-component-select';select.textContent='⠿';select.draggable=true;select.setAttribute('aria-label',`Select ${node.attrs.name??node.attrs.tag??'component'}`);dom.append(select);
   select.onmousedown=e=>{e.preventDefault();const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc,pos)));};
   const handle=window.document.createElement('button');handle.type='button';handle.className='mdx-resize';handle.setAttribute('aria-label','Resize component');handle.textContent='↘';dom.append(handle);
   function draw(){
    dom.dataset.nodeId=current.attrs.id;
    if(current.attrs.name==='Helmet'){content.textContent='Document data and settings';return;}
    dom.style.cssFloat=['left','right'].includes(current.attrs.props.float)?current.attrs.props.float:'none';
    dom.style.width=typeof current.attrs.props.width==='number'?`${current.attrs.props.width}px`:'';
    dom.style.minHeight=typeof current.attrs.props.height==='number'?`${current.attrs.props.height}px`:'';
    handle.hidden=!editable();select.hidden=!editable();
    const canonical=editorDocument(v.state.doc);const source=documentJsx({...canonical,rootId:current.attrs.id});const parsed=parseJsx(source);
    root.render(parsed.ok?<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" store={store} chrome={false}/>:<span role="alert">Could not render component.</span>);
   }
   function resize(width:number,height:number){const pos=getPos();if(pos===undefined||!editable())return;const tr=v.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,props:{...current.attrs.props,width:Math.round(Math.max(48,width)),height:Math.round(Math.max(32,height))}});tr.setSelection(NodeSelection.create(tr.doc,pos));v.dispatch(tr);}
   handle.onkeydown=event=>{if(!editable()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const rect=dom.getBoundingClientRect();resize(Number(current.attrs.props.width??rect.width)+(event.key==='ArrowRight'?10:event.key==='ArrowLeft'?-10:0),Number(current.attrs.props.height??rect.height)+(event.key==='ArrowDown'?10:event.key==='ArrowUp'?-10:0));};
   handle.onpointerdown=event=>{
    if(!editable())return;event.preventDefault();event.stopPropagation();const x=event.clientX,y=event.clientY,rect=dom.getBoundingClientRect();handle.setPointerCapture(event.pointerId);
    const move=(e:PointerEvent)=>{dom.style.width=`${Math.max(48,rect.width+e.clientX-x)}px`;dom.style.minHeight=`${Math.max(32,rect.height+e.clientY-y)}px`;};
    const up=(e:PointerEvent)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);resize(rect.width+e.clientX-x,rect.height+e.clientY-y);};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up,{once:true});handle.addEventListener('pointercancel',()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);draw();},{once:true});
   };
   // NodeViews are constructed while the EditorView is still initializing.
   queueMicrotask(()=>{if(dom.isConnected)draw();});
   return {dom,update(next){if(next.type!==current.type)return false;current=next;draw();return true;},selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');},stopEvent:event=>!event.type.startsWith('drag')&&event.type!=='drop'&&(event.target===handle||!!(event.target as Element)?.closest?.('iframe,input,select,textarea,button')),ignoreMutation:()=>true,destroy(){queueMicrotask(()=>root.unmount());}};
  }
  function containerView(node:PmNode,v:EditorView,getPos:()=>number|undefined):NodeView{
   const dom=window.document.createElement('div'),contentDOM=window.document.createElement('div');dom.className='mdx-container';contentDOM.className='mdx-container-content';dom.append(contentDOM);let current=node;
   const controls=window.document.createElement('div');controls.className='mdx-container-controls';controls.contentEditable='false';dom.append(controls);
   function draw(){
    const props=current.attrs.props;dom.dataset.nodeId=current.attrs.id;dom.dataset.container=current.attrs.name??current.attrs.tag;
    dom.style.minHeight=typeof props.height==='number'?`${props.height}px`:'';
    dom.style.width=typeof props.width==='number'?`${props.width}px`:'';dom.style.cssFloat=['left','right'].includes(props.float)?props.float:'none';
    contentDOM.style.minHeight=typeof props.height==='number'?`${Math.max(0,props.height-24)}px`:'';
    contentDOM.style.display=current.attrs.name==='Flex'?'flex':'block';contentDOM.style.flexDirection=props.direction==='column'?'column':'row';contentDOM.style.gap='16px';
    controls.replaceChildren();controls.hidden=!editable();
    const select=window.document.createElement('button');select.type='button';select.draggable=true;select.textContent='⠿';select.setAttribute('aria-label',`Select ${current.attrs.name??'container'}`);controls.append(select);
    select.onmousedown=e=>{e.preventDefault();const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc,pos)));};
    if(current.attrs.name!=='Flex')return;
    const sizes=flexRatios(props.sizes,current.childCount);
    const sheet=window.document.createElement('style');controls.append(sheet);
    const layout=(ratios:number[])=>{sheet.textContent=ratios.map((size,i)=>`.mdx-container[data-node-id="${current.attrs.id}"] > .mdx-container-content > :nth-child(${i+1}){flex:${size} 1 0;min-width:0}`).join('');};layout(sizes);
    for(let i=0;i<sizes.length-1;i++){
     const handle=window.document.createElement('button');handle.type='button';handle.textContent='↔';handle.setAttribute('aria-label',`Resize layout divider ${i+1}`);controls.append(handle);
     handle.onkeydown=event=>{if(!editable()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const pos=getPos();if(pos===undefined)return;const next=resizeFlexRatios(sizes,i,['ArrowRight','ArrowDown'].includes(event.key)?20:-20,props.direction==='column'?contentDOM.clientHeight:contentDOM.clientWidth);const tr=v.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,props:{...props,sizes:next}});tr.setSelection(NodeSelection.create(tr.doc,pos));v.dispatch(tr);};
     handle.onpointerdown=event=>{
      if(!editable())return;event.preventDefault();const column=props.direction==='column',start=column?event.clientY:event.clientX,extent=column?contentDOM.clientHeight:contentDOM.clientWidth;handle.setPointerCapture(event.pointerId);
      let next=sizes.slice();
      const move=(e:PointerEvent)=>{next=resizeFlexRatios(sizes,i,(column?e.clientY:e.clientX)-start,extent);layout(next);};
      const up=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,props:{...props,sizes:next}}));};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up,{once:true});handle.addEventListener('pointercancel',()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);draw();},{once:true});
     };
    }
   }
   queueMicrotask(draw);
   return {dom,contentDOM,update(next){if(next.type!==current.type)return false;current=next;queueMicrotask(draw);return true;},ignoreMutation:mutation=>mutation.type!=='selection'&&(mutation.type==='attributes'&&mutation.attributeName==='style'||!contentDOM.contains(mutation.target)),stopEvent:event=>!event.type.startsWith('drag')&&event.type!=='drop'&&controls.contains(event.target as Node)};
  }
 return {component:componentView,inline_component:componentView,container:containerView};
}
