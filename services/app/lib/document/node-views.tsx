/** DOM ownership boundary: editable slots belong to ProseMirror; component contents belong to React.
 * Layout styles live outside editable children so resizing never feeds back as text mutations.
 */
import {createRoot,type Root} from 'react-dom/client';
import {NodeSelection} from 'prosemirror-state';
import type {EditorView,NodeView} from 'prosemirror-view';
import type {Node as PmNode} from 'prosemirror-model';
import {widthPercentage} from '../story-ui/flex-layout';
import {containerNodeView} from './container-view';
import {dimensionPreview,nodeParentExtent,setDocumentNodeProps} from './editor-layout';
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
   select.onmousedown=()=>{const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc,pos)));};select.onclick=e=>{if(e.detail===0){const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc,pos)));}};
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
   function resize(width:number,height:number){const pos=getPos();if(pos===undefined||!editable())return;setDocumentNodeProps(v,pos,{width:Math.round(Math.max(48,width)),height:Math.round(Math.max(32,height))});}
   handle.onkeydown=event=>{if(!editable()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const rect=dom.getBoundingClientRect();resize(Number(current.attrs.props.width??rect.width)+(event.key==='ArrowRight'?10:event.key==='ArrowLeft'?-10:0),Number(current.attrs.props.height??rect.height)+(event.key==='ArrowDown'?10:event.key==='ArrowUp'?-10:0));};
   handle.onpointerdown=event=>{
    if(!editable())return;event.preventDefault();event.stopPropagation();const x=event.clientX,y=event.clientY,rect=dom.getBoundingClientRect();handle.setPointerCapture(event.pointerId);
    const feedback=document.createElement('output');feedback.className='mdx-size-feedback';dom.append(feedback);const pos=getPos(),preview=pos===undefined?null:dimensionPreview(v,pos,dom);
    const move=(e:PointerEvent)=>{preview?.update(Math.max(48,rect.width+e.clientX-x),Math.max(32,rect.height+e.clientY-y));feedback.textContent=`${widthPercentage(Math.max(48,rect.width+e.clientX-x),pos===undefined?0:nodeParentExtent(v,pos))}% · ${Math.round(Math.max(32,rect.height+e.clientY-y))} px`;dom.style.width=`${Math.max(48,rect.width+e.clientX-x)}px`;dom.style.minHeight=`${Math.max(32,rect.height+e.clientY-y)}px`;};
    const up=(e:PointerEvent)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);preview?.clear();feedback.remove();resize(rect.width+e.clientX-x,rect.height+e.clientY-y);};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up,{once:true});handle.addEventListener('pointercancel',()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);preview?.clear();feedback.remove();draw();},{once:true});
   };
   // NodeViews are constructed while the EditorView is still initializing.
   queueMicrotask(()=>{if(dom.isConnected)draw();});
   return {dom,update(next){if(next.type!==current.type)return false;current=next;draw();return true;},selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');},stopEvent:event=>!event.type.startsWith('drag')&&event.type!=='drop'&&(event.target===handle||!!(event.target as Element)?.closest?.('iframe,input,select,textarea,button')),ignoreMutation:()=>true,destroy(){queueMicrotask(()=>root.unmount());}};
  }
 return {component:componentView,inline_component:componentView,container:(node:PmNode,view:EditorView,getPos:()=>number|undefined)=>containerNodeView(node,view,getPos,editable)};
}
