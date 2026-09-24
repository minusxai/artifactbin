import {useEffect,useRef,useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {EditorView, type NodeView} from 'prosemirror-view';
import {NodeSelection, type Transaction} from 'prosemirror-state';
import {toggleMark,setBlockType,wrapIn} from 'prosemirror-commands';
import {wrapInList} from 'prosemirror-schema-list';
import {undo,redo} from 'prosemirror-history';
import type {Node as PmNode} from 'prosemirror-model';
import type {RichDocument,DocumentJson} from '@artifactbin/contracts';
import {createDocumentEditorState,documentEditorNode,documentEditorSchema,editorDocument} from '@/lib/document/editor';
import {documentJsx,parseDocumentMdx,validateDocumentMarkup} from '@/lib/document/mdx';
import {parseJsx} from '@/lib/jsx/parse';
import {StoryRuntimeApp} from '@/lib/story-runtime/StoryRuntimeApp';
import {createDataflowStore} from '@/lib/story-runtime/store';
import {EMPTY_DATAFLOW} from '@/lib/story/dataflow';
import {Tooltip} from './Tooltip';
import './document-editor.css';

interface Props {document:RichDocument;editable?:boolean;onChange:(document:RichDocument)=>void}
/** The view owns selection and IME; parent save/status renders never recreate it. */
export function DocumentEditor({document:initial,editable=true,onChange}:Props){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef({onChange,editable});latest.current={onChange,editable};
 const [selection,setSelection]=useState<{id:string;props:Record<string,DocumentJson>;name:string}|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!host.current)return;
  const store=createDataflowStore({flow:EMPTY_DATAFLOW});
  function updateSelection(v:EditorView){
   const {selection:s}=v.state;const node=s instanceof NodeSelection?s.node:s.$from.parent;
   setSelection(node.attrs.id?{id:node.attrs.id,props:node.attrs.props,name:node.attrs.name??node.attrs.nodeType??node.type.name}:null);
  }
  function componentView(node:PmNode,v:EditorView,getPos:()=>number|undefined):NodeView{
   const dom=window.document.createElement(node.isInline?'span':'div');dom.className='mdx-component';dom.contentEditable='false';
   const content=window.document.createElement(node.isInline?'span':'div');dom.append(content);let current=node;const root:Root=createRoot(content);
   const handle=window.document.createElement('button');handle.type='button';handle.className='mdx-resize';handle.setAttribute('aria-label','Resize component');handle.textContent='↘';dom.append(handle);
   function draw(){
    dom.dataset.nodeId=current.attrs.id;
    dom.style.cssFloat=['left','right'].includes(current.attrs.props.float)?current.attrs.props.float:'none';
    dom.style.width=typeof current.attrs.props.width==='number'?`${current.attrs.props.width}px`:'';
    dom.style.minHeight=typeof current.attrs.props.height==='number'?`${current.attrs.props.height}px`:'';
    handle.hidden=!latest.current.editable;
    const canonical=editorDocument(v.state.doc);const source=documentJsx({...canonical,rootId:current.attrs.id});const parsed=parseJsx(source);
    root.render(parsed.ok?<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" store={store} chrome={false}/>:<span role="alert">Could not render component.</span>);
   }
   handle.onpointerdown=event=>{
    event.preventDefault();event.stopPropagation();const x=event.clientX,y=event.clientY,rect=dom.getBoundingClientRect();handle.setPointerCapture(event.pointerId);
    const move=(e:PointerEvent)=>{dom.style.width=`${Math.max(48,rect.width+e.clientX-x)}px`;dom.style.minHeight=`${Math.max(32,rect.height+e.clientY-y)}px`;};
    const up=(e:PointerEvent)=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,props:{...current.attrs.props,width:Math.round(Math.max(48,rect.width+e.clientX-x)),height:Math.round(Math.max(32,rect.height+e.clientY-y))}}));};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);
   };
   // NodeViews are constructed while the EditorView is still initializing.
   queueMicrotask(()=>{if(dom.isConnected)draw();});
   return {dom,update(next){if(next.type!==current.type)return false;current=next;draw();return true;},selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');},stopEvent:event=>event.target===handle||!!(event.target as Element)?.closest?.('iframe,input,select,textarea,button'),ignoreMutation:()=>true,destroy(){queueMicrotask(()=>root.unmount());}};
  }
  function containerView(node:PmNode,v:EditorView,getPos:()=>number|undefined):NodeView{
   const dom=window.document.createElement('div'),contentDOM=window.document.createElement('div');dom.className='mdx-container';contentDOM.className='mdx-container-content';dom.append(contentDOM);let current=node;
   const controls=window.document.createElement('div');controls.className='mdx-container-controls';controls.contentEditable='false';dom.append(controls);
   function draw(){
    const props=current.attrs.props;dom.dataset.nodeId=current.attrs.id;dom.dataset.container=current.attrs.name??current.attrs.tag;
    dom.style.minHeight=typeof props.height==='number'?`${props.height}px`:'';
    contentDOM.style.display=current.attrs.name==='Flex'?'flex':'block';contentDOM.style.flexDirection=props.direction==='column'?'column':'row';contentDOM.style.gap='16px';
    controls.replaceChildren();controls.hidden=!latest.current.editable;
    if(current.attrs.name!=='Flex')return;
    const sizes=Array.from({length:current.childCount},(_,i)=>Number(props.sizes?.[i]??1));
    const sheet=window.document.createElement('style');controls.append(sheet);
    const layout=(ratios:number[])=>{sheet.textContent=ratios.map((size,i)=>`.mdx-container[data-node-id="${current.attrs.id}"] > .mdx-container-content > :nth-child(${i+1}){flex:${size} 1 0;min-width:0}`).join('');};layout(sizes);
    for(let i=0;i<sizes.length-1;i++){
     const handle=window.document.createElement('button');handle.type='button';handle.textContent='↔';handle.setAttribute('aria-label',`Resize layout divider ${i+1}`);controls.append(handle);
     handle.onpointerdown=event=>{
      event.preventDefault();const column=props.direction==='column',start=column?event.clientY:event.clientX,extent=column?contentDOM.clientHeight:contentDOM.clientWidth,total=sizes.reduce((a,b)=>a+b,0),pair=sizes[i]+sizes[i+1];handle.setPointerCapture(event.pointerId);
      let next=sizes.slice();
      const move=(e:PointerEvent)=>{const delta=((column?e.clientY:e.clientX)-start)/Math.max(1,extent)*total;next=sizes.slice();next[i]=Math.max(.1,Math.min(pair-.1,sizes[i]+delta));next[i+1]=pair-next[i];layout(next);};
      const up=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);const pos=getPos();if(pos!==undefined)v.dispatch(v.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,props:{...props,sizes:next}}));};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);
     };
    }
   }
   queueMicrotask(draw);
   return {dom,contentDOM,update(next){if(next.type!==current.type)return false;current=next;queueMicrotask(draw);return true;},ignoreMutation:mutation=>mutation.type!=='selection'&&(mutation.type==='attributes'&&mutation.attributeName==='style'||!contentDOM.contains(mutation.target)),stopEvent:event=>controls.contains(event.target as Node)};
  }
  const v=new EditorView(host.current,{state:createDocumentEditorState(initial),editable:()=>latest.current.editable,attributes:{'aria-label':'Document editor',role:'textbox','aria-multiline':'true'},nodeViews:{component:componentView,inline_component:componentView,container:containerView},dispatchTransaction(tr){
   try{
    const next=v.state.applyTransaction(tr).state;
    if(tr.docChanged){const document=editorDocument(next.doc);validateDocumentMarkup(document);v.updateState(next);latest.current.onChange(document);}else v.updateState(next);
    updateSelection(v);setError('');
   }catch(e){setError(e instanceof Error?e.message:'Could not apply this change.');}
  }});
  view.current=v;updateSelection(v);
  return()=>{view.current=null;v.destroy();store.dispose();};
 },[]);
 useEffect(()=>{
  const v=view.current;if(!v)return;v.setProps({editable:()=>editable});
  const current=editorDocument(v.state.doc);if(JSON.stringify(current)===JSON.stringify(initial))return;
  // Replace the smallest differing interval, so independent remote edits preserve selection/history mappings.
  const target=documentEditorNode(initial),start=v.state.doc.content.findDiffStart(target.content);if(start===null)return;
  const end=v.state.doc.content.findDiffEnd(target.content)!;const overlap=start-Math.min(end.a,end.b);
  const tr=v.state.tr.replace(start,end.a+Math.max(0,overlap),target.slice(start,end.b+Math.max(0,overlap))).setMeta('addToHistory',false);
  v.updateState(v.state.applyTransaction(tr).state);
 },[initial,editable]);
 function command(run:(v:EditorView)=>void){const v=view.current;if(v){run(v);v.focus();}}
 function props(patch:Record<string,DocumentJson>){command(v=>{const selected=v.state.selection instanceof NodeSelection?v.state.selection.from:v.state.selection.$from.before();if(selected<0)return;const node=v.state.doc.nodeAt(selected);if(node)v.dispatch(v.state.tr.setNodeMarkup(selected,undefined,{...node.attrs,props:{...node.attrs.props,...patch}}));});}
 function insert(source:string){command(v=>{const added=documentEditorNode(parseDocumentMdx(source));v.dispatch(v.state.tr.replaceSelectionWith(added.firstChild!).scrollIntoView());});}
 function button(label:string,action:()=>void){return <Tooltip content={label}><button type="button" aria-label={label} onMouseDown={e=>e.preventDefault()} onClick={action}>{label}</button></Tooltip>;}
 function dispatch(v:EditorView){return (tr:Transaction)=>v.dispatch(tr);}
 const s=documentEditorSchema;
 return <div className="mdx-editor-shell">
  {editable&&<div className="mdx-toolbar" role="toolbar" aria-label="Document formatting">
   {button('Undo',()=>command(v=>undo(v.state,dispatch(v))))}{button('Redo',()=>command(v=>redo(v.state,dispatch(v))))}
   <select aria-label="Block style" onChange={e=>command(v=>setBlockType(e.target.value==='paragraph'?s.nodes.paragraph:s.nodes.heading,{id:selection?.id,props:e.target.value==='paragraph'?{}:{depth:Number(e.target.value)},nodeType:e.target.value==='paragraph'?'paragraph':'heading'})(v.state,dispatch(v)))} defaultValue="paragraph"><option value="paragraph">Paragraph</option>{[1,2,3].map(n=><option key={n} value={n}>Heading {n}</option>)}</select>
   {button('Bold',()=>command(v=>toggleMark(s.marks.strong)(v.state,dispatch(v))))}{button('Italic',()=>command(v=>toggleMark(s.marks.emphasis)(v.state,dispatch(v))))}
   {button('Bullet list',()=>command(v=>wrapInList(s.nodes.bullet_list)(v.state,dispatch(v))))}{button('Quote',()=>command(v=>wrapIn(s.nodes.blockquote)(v.state,dispatch(v))))}
   <select aria-label="Text font" defaultValue="" onChange={e=>command(v=>{if(v.state.selection.empty)props({className:e.target.value});else toggleMark(s.marks.span,{className:e.target.value})(v.state,dispatch(v));})}><option value="">Font</option><option value="font-sans">Sans</option><option value="font-serif">Serif</option><option value="font-mono">Mono</option></select>
   {button('Insert columns',()=>insert('<Flex direction="row" sizes={[1,1]}>\n\nFirst column\n\nSecond column\n\n</Flex>'))}
   {button('Insert iframe',()=>insert('<Iframe title="Interactive example" height={180}><div style="padding:24px;background:#e0f2fe">An editable HTML component</div></Iframe>'))}
   {button('Insert image',()=>insert('<img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600" alt="Forest" width={240} />'))}
   <select aria-label="Float component" value={String(selection?.props.float??'disabled')} onChange={e=>props({float:e.target.value})}><option value="disabled">No float</option><option value="left">Float left</option><option value="right">Float right</option></select>
   <label>Width <input aria-label="Component width" type="number" min="48" value={typeof selection?.props.width==='number'?selection.props.width:''} onChange={e=>props({width:Number(e.target.value)})}/></label>
   <label>Height <input aria-label="Component height" type="number" min="32" value={typeof selection?.props.height==='number'?selection.props.height:''} onChange={e=>props({height:Number(e.target.value)})}/></label>
  </div>}
  {error&&<p role="alert">{error}</p>}<div ref={host} className="mdx-editor-body"/>
 </div>;
}
