import {Undo2,Redo2,Bold,Italic,List,Quote,Columns2,SquareDashed,ImagePlus} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {EditorView} from 'prosemirror-view';
import {NodeSelection, type Transaction} from 'prosemirror-state';
import {toggleMark,setBlockType,wrapIn} from 'prosemirror-commands';
import {wrapInList} from 'prosemirror-schema-list';
import {undo,redo} from 'prosemirror-history';
import type {RichDocument,DocumentJson} from '@artifactbin/contracts';
import {createDocumentEditorState,documentEditorNode,documentEditorSchema,editorDocument} from '@/lib/document/editor';
import {parseDocumentMdx,validateDocumentMarkup} from '@/lib/document/mdx';
import {nodeWidthPercentage,setNodeWidthPercentage,setDocumentNodeProps} from '@/lib/document/editor-layout';
import {documentNodeViews} from '@/lib/document/node-views';
import {documentValueEqual} from '@/lib/document/model';
import {createDataflowStore} from '@/lib/story-runtime/store';
import {documentJsx,parseDocumentJsx} from '@/lib/document/markup';
import {splitHelmet} from '@/lib/story/helmet';
import {createAuthenticatedTransport} from '@/lib/story-runtime/authenticated-transport';
import type {DataflowStore} from '@/lib/story-runtime/store';
import {Tooltip} from './Tooltip';
import './document-editor.css';

/** Keep the user's partial number while typing; layout clamps must not rewrite their next digit. */
function DimensionInput({label,value,min,max,onChange}:{label:string;value:number|string;min:number;max?:number;onChange:(value:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 return <input aria-label={label} type="number" min={min} max={max} step="0.1" value={draft??value} onChange={e=>{setDraft(e.target.value);if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))onChange(e.target.valueAsNumber);}} onBlur={()=>setDraft(null)}/>;
}
interface Props {artifactId?:string;document:RichDocument;editable?:boolean;onChange:(document:RichDocument)=>void}
/** The view owns selection and IME; parent save/status renders never recreate it. */
export function DocumentEditor({document:initial,editable=true,onChange,artifactId}:Props){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef({onChange,editable});latest.current={onChange,editable};
 const [selection,setSelection]=useState<{id:string;props:Record<string,DocumentJson>;name:string;text?:string;resizable:boolean;widthPercent:number}|null>(null);
 const [history,setHistory]=useState({undo:false,redo:false});
 const [error,setError]=useState('');const dataflow=useRef<DataflowStore|null>(null);
 function flow(document:RichDocument){const {values,queries,mutations}=splitHelmet(parseDocumentJsx(documentJsx(document))).content;return {values,queries,mutations};}
 useEffect(()=>{
  if(!host.current)return;
  const store=createDataflowStore({flow:flow(initial)});dataflow.current=store;
  function updateSelection(v:EditorView){
   setHistory({undo:undo(v.state),redo:redo(v.state)});
   const {selection:s}=v.state;const node=s instanceof NodeSelection?s.node:s.$from.parent;
   setSelection(node.attrs.id?{id:node.attrs.id,props:node.attrs.props,resizable:['container','component','inline_component'].includes(node.type.name),widthPercent:nodeWidthPercentage(v,s instanceof NodeSelection?s.from:s.$from.depth?s.$from.before():0),text:node.attrs.text??undefined,name:node.attrs.name??node.attrs.nodeType??node.type.name}:null);
  }
  const v=new EditorView(host.current,{state:createDocumentEditorState(initial),editable:()=>latest.current.editable,attributes:{'aria-label':'Document editor',role:'textbox','aria-multiline':'true'},nodeViews:documentNodeViews(store,()=>latest.current.editable),dispatchTransaction(tr){
   try{
    const next=v.state.applyTransaction(tr).state;
    if(tr.docChanged){const document=editorDocument(next.doc);validateDocumentMarkup(document);v.updateState(next);latest.current.onChange(document);}else v.updateState(next);
    updateSelection(v);queueMicrotask(()=>{if(view.current===v)updateSelection(v);});setError('');
   }catch(e){setError(e instanceof Error?e.message:'Could not apply this change.');}
  }});
  view.current=v;updateSelection(v);
  return()=>{view.current=null;v.destroy();store.dispose();dataflow.current=null;};
 },[]);
 useEffect(()=>{const store=dataflow.current;if(!store)return;const transport=artifactId?createAuthenticatedTransport(artifactId):null;store.setTransport(transport);store.start();return()=>{store.setTransport(null);transport?.dispose();};},[artifactId]);
 useEffect(()=>{const store=dataflow.current;if(!store)return;const next=flow(initial);if(!documentValueEqual(store.flow,next))store.replaceFlow({flow:next});},[initial]);
 useEffect(()=>{
  const v=view.current;if(!v)return;v.setProps({editable:()=>editable});
  const current=editorDocument(v.state.doc);if(documentValueEqual(current,initial))return;
  // Replace the smallest differing interval, so independent remote edits preserve selection/history mappings.
  const target=documentEditorNode(initial),start=v.state.doc.content.findDiffStart(target.content);if(start===null)return;
  const end=v.state.doc.content.findDiffEnd(target.content)!;const overlap=start-Math.min(end.a,end.b);
  const tr=v.state.tr.replace(start,end.a+Math.max(0,overlap),target.slice(start,end.b+Math.max(0,overlap))).setMeta('addToHistory',false);
  v.updateState(v.state.applyTransaction(tr).state);setHistory({undo:undo(v.state),redo:redo(v.state)});
 },[initial,editable]);
 function command(run:(v:EditorView)=>void,focus=true){const v=view.current;if(v){run(v);if(focus)v.focus();}}
 function props(patch:Record<string,DocumentJson>){command(v=>{const pos=v.state.selection instanceof NodeSelection?v.state.selection.from:v.state.selection.$from.depth?v.state.selection.$from.before():-1;if(pos>=0)setDocumentNodeProps(v,pos,patch);},false);}
 function widthPercent(value:number){command(v=>{const pos=v.state.selection instanceof NodeSelection?v.state.selection.from:v.state.selection.$from.depth?v.state.selection.$from.before():-1;if(pos>=0)setNodeWidthPercentage(v,pos,value);},false);}
 function insert(source:string){command(v=>{const added=documentEditorNode(parseDocumentMdx(source));v.dispatch(v.state.tr.replaceSelectionWith(added.firstChild!).scrollIntoView());});}
 const icons:Record<string,typeof Bold>={'Undo':Undo2,'Redo':Redo2,'Bold':Bold,'Italic':Italic,'Bullet list':List,'Quote':Quote,'Insert columns':Columns2,'Style block':SquareDashed,'Insert image':ImagePlus};
 function button(label:string,action:()=>void,disabled=false){const Icon=icons[label];return <Tooltip content={label}><button type="button" aria-label={label} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={action}>{Icon?<Icon size={16}/>:label}</button></Tooltip>;}
 function dispatch(v:EditorView){return (tr:Transaction)=>v.dispatch(tr);}
 const s=documentEditorSchema;
 return <div className="mdx-editor-shell">
  {editable&&<div className="mdx-toolbar" role="toolbar" aria-label="Document formatting">
   {button('Undo',()=>command(v=>undo(v.state,dispatch(v))),!history.undo)}{button('Redo',()=>command(v=>redo(v.state,dispatch(v))),!history.redo)}
   {!selection?.resizable&&<>
   <select aria-label="Block style" onChange={e=>command(v=>setBlockType(e.target.value==='paragraph'?s.nodes.paragraph:s.nodes.heading,{id:selection?.id,props:e.target.value==='paragraph'?{}:{depth:Number(e.target.value)},nodeType:e.target.value==='paragraph'?'paragraph':'heading'})(v.state,dispatch(v)))} defaultValue="paragraph"><option value="paragraph">Paragraph</option>{[1,2,3].map(n=><option key={n} value={n}>Heading {n}</option>)}</select>
   {button('Bold',()=>command(v=>toggleMark(s.marks.strong)(v.state,dispatch(v))))}{button('Italic',()=>command(v=>toggleMark(s.marks.emphasis)(v.state,dispatch(v))))}
   {button('Bullet list',()=>command(v=>wrapInList(s.nodes.bullet_list)(v.state,dispatch(v))))}{button('Quote',()=>command(v=>wrapIn(s.nodes.blockquote)(v.state,dispatch(v))))}
   <select aria-label="Text font" defaultValue="" onChange={e=>command(v=>{if(v.state.selection.empty)props({className:e.target.value});else v.dispatch(v.state.tr.addMark(v.state.selection.from,v.state.selection.to,s.marks.span.create({className:e.target.value})));})}><option value="">Font</option><option value="font-sans">Sans</option><option value="font-serif">Serif</option><option value="font-mono">Mono</option></select>
   </>}
   {button('Insert columns',()=>insert('<Flex direction="row" sizes={[1,1]}>\n\n<div>\n\nFirst column\n\n</div>\n\n<div>\n\nSecond column\n\n</div>\n\n</Flex>'))}
   {button('Style block',()=>command(v=>wrapIn(s.nodes.container,{tag:'div',nodeType:'html',props:{className:'p-6 bg-slate-50 rounded-lg'}})(v.state,dispatch(v))))}
   {button('Insert image',()=>insert('<img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600" alt="Forest" width={240} />'))}
   {selection?.resizable&&<div className="mdx-selection-tools">
   {selection?.name==='Flex'&&<select aria-label="Layout direction" value={String(selection.props.direction??'row')} onChange={e=>props({direction:e.target.value})}><option value="row">Columns</option><option value="column">Rows</option></select>}
   <select aria-label="Float component" value={String(selection?.props.float??'disabled')} onChange={e=>props({float:e.target.value})}><option value="disabled">No float</option><option value="left">Float left</option><option value="right">Float right</option></select>
   <label>Class <input aria-label="Block CSS class" value={String(selection.props.className??'')} onChange={e=>props({className:e.target.value})}/></label>
   <label>Width <DimensionInput key={selection?.id} label="Width of parent (%)" min={1} max={100} value={selection?.widthPercent??''} onChange={widthPercent}/> %</label>
   <label>px <DimensionInput key={selection?.id} label="Component width" min={48} value={typeof selection?.props.width==='number'?selection.props.width:''} onChange={width=>props({width})}/></label>
   <label>Height <DimensionInput key={selection?.id} label="Component height" min={32} value={typeof selection?.props.height==='number'?selection.props.height:''} onChange={height=>props({height})}/></label>
   </div>}
  </div>}

  {error&&<p role="alert">{error}</p>}<div ref={host} className="mdx-editor-body"/>
 </div>;
}
