/** File-session shell; rendering and in-place editing remain shared with hosted artifacts. */
import {useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InlineStoryRuntime,type InlineStoryController} from '../../../app/lib/story-runtime/InlineStoryRuntime';
import {parseJsx,type JsxNode} from '../../../app/lib/jsx';
import {splitHelmet} from '../../../app/lib/story/helmet';
import {useInPlaceEdit} from '../../../app/lib/story/use-in-place-edit';
import type {StoryIslandData} from '../../../app/lib/story-runtime/contract';
import {STORY_DOCUMENT_MESSAGE} from '../../../app/lib/story-runtime/contract';
import type {QueryTransport} from '../../../app/lib/story-runtime/store';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared-runtime';
interface Document {body:string;revision:string;data:StoryIslandData;prepared?:PreparedStoryRuntime}
interface Comment {id:string;node:string;name:string;text:string}
const capture=new URLSearchParams(location.search).get('capture')==='1';
const file=decodeURIComponent(location.pathname.slice('/workspace/'.length));
async function api(path:string,body?:unknown){
 const response=await fetch(path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error);return value;
}
function anchors(nodes:JsxNode[]):string[]{
 return nodes.flatMap(node=>node.type==='element'?[
  ...node.attributes.flatMap(attr=>attr.name==='id'&&attr.value.static&&typeof attr.value.json==='string'?[attr.value.json]:[]),...anchors(node.children)
 ]:[]);
}
function App({initial}:{initial:Document}){
 const [ready,setReady]=useState(!initial.data.dataflow?.flow.queries.length);
 const [document,setDocument]=useState(initial),[source,setSource]=useState(initial.body),[status,setStatus]=useState('Ready');
 const [editing,setEditing]=useState(false),[nonce,setNonce]=useState<string|null>(null);
 const [comments,setComments]=useState<Comment[]>([]),[name,setName]=useState(localStorage.getItem('afbin-preview-name')??''),[text,setText]=useState(''),[node,setNode]=useState('');
 const [files,setFiles]=useState<string[]>([]);
 const runtimeRef=useRef<InlineStoryController|null>(null),sourceRef=useRef(source),dirty=useRef(false),revision=useRef(initial.revision);
 sourceRef.current=source;
 const adopt=(next:Document)=>{
  revision.current=next.revision;sourceRef.current=next.body;setDocument(next);setSource(next.body);
  runtimeRef.current?.update({type:STORY_DOCUMENT_MESSAGE,nodes:next.data.nodes,dataflow:next.data.dataflow,refData:next.data.refData,...(next.prepared?{compiledCss:next.prepared.compiledCss,authorCss:next.prepared.authorCss,authorScript:next.prepared.authorScript,theme:next.prepared.theme}:{})});
 };
 const edit=useInPlaceEdit({runtimeRef,sourceRef,editing,sessionNonce:nonce,onSourceEdited:next=>{
  dirty.current=true;sourceRef.current=next;setSource(next);
  const parsed=parseJsx(next);if(parsed.ok)runtimeRef.current?.update({type:STORY_DOCUMENT_MESSAGE,nodes:splitHelmet(parsed.nodes).body});
  setStatus('Unsaved');
 }});
 const onController=useCallback((controller:InlineStoryController|null)=>{runtimeRef.current=controller;setNonce(controller?.nonce??null);},[]);
 const [transport]=useState<QueryTransport>(()=>({run:async(values,only)=>{try{return await api('/query',{file,values,only});}finally{setReady(true);}},page:async(values,name,page)=>{
  const result=await api('/query',{file,values,only:[name],page:{name,...page}});return result.tables[name];
 }}));
 useEffect(()=>{
  if(capture)return;
  void api('/files').then(setFiles).catch(error=>setStatus(error.message));
  const unload=(event:BeforeUnloadEvent)=>{if(dirty.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);
 },[]);
 useEffect(()=>{
  if(capture)return;
  const poll=setInterval(()=>{
   void api('/document?file='+encodeURIComponent(file)).then((next:Document)=>{
    if(next.revision!==revision.current&&!dirty.current&&!edit.isUserEditing()){adopt(next);setStatus('Refreshed');}
   }).catch(error=>setStatus(error.message));
   void api('/comments?file='+encodeURIComponent(file)).then(setComments).catch(error=>setStatus(error.message));
  },750);return()=>clearInterval(poll);
 },[edit]);
 const save=async()=>{
  if(editing)await edit.commitPending(true);
  const next:Document=await api('/save',{file,revision:revision.current,body:sourceRef.current});
  dirty.current=false;adopt(next);setStatus('Saved');return next;
 };
 const action=(run:()=>Promise<unknown>)=>void run().catch(error=>setStatus(error instanceof Error?error.message:String(error)));
 const toggle=()=>action(async()=>{if(editing){await edit.commitPending(true);setEditing(false);}else{await save();setEditing(true);}});
 const comment=()=>action(async()=>{
  if(!name.trim()||!text.trim())throw Error('Enter your name and comment.');
  const current=await save(),anchor=node||anchors(current.data.nodes)[0];
  if(!anchor)throw Error('Add a document element before commenting.');
  await api('/comments',{file,node:anchor,name:name.trim(),text:text.trim()});
  localStorage.setItem('afbin-preview-name',name.trim());setText('');setStatus('Comment saved');
 });
 if(capture)return <div data-afbin-export-ready={ready?'':undefined}><InlineStoryRuntime data={document.data} prepared={document.prepared} authorScript={document.prepared?.authorScript} transport={transport} onController={onController}/></div>;
 return <main>
  <header className="afbin-tools"><strong>Artifactbin preview</strong><nav aria-label="Files">{files.map(path=><a key={path} aria-current={path===file?'page':undefined} href={'/workspace/'+path.split('/').map(encodeURIComponent).join('/')}>{path}</a>)}</nav>
   <p role="status" aria-live="polite">{status}</p><button onClick={toggle}>{editing?'Stop editing':'Edit document'}</button><button onClick={()=>action(save)}>Save file</button>
  </header>
  <InlineStoryRuntime data={document.data} prepared={document.prepared} authorScript={document.prepared?.authorScript} transport={transport} onController={onController}/>
  <section className="afbin-tools" aria-label="Source and comments">
   <label>Source<textarea aria-label="Source" rows={8} value={source} onChange={event=>{dirty.current=true;sourceRef.current=event.target.value;setSource(event.target.value);setStatus('Unsaved');}}/></label>
   <h2>Comments</h2><label>Your name<input aria-label="Name" value={name} onChange={event=>setName(event.target.value)}/></label>
   <label>Document element<select aria-label="Comment anchor" value={node} onChange={event=>setNode(event.target.value)}><option value="">First element</option>{anchors(document.data.nodes).map(id=><option key={id} value={id}>{id}</option>)}</select></label>
   <label>Comment<textarea aria-label="Comment" value={text} onChange={event=>setText(event.target.value)}/></label><button onClick={comment}>Add comment</button>
   <ul aria-label="Comments">{comments.map(comment=><li key={comment.id}><strong>{comment.name}</strong> · {comment.node}<p>{comment.text}</p></li>)}</ul>
  </section>
 </main>;
}
void api('/document?file='+encodeURIComponent(file)).then(document=>createRoot(window.document.getElementById('root')!).render(<App initial={document}/>)).catch(error=>{window.document.getElementById('root')!.textContent=error.message;});
