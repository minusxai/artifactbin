/** Local editor chrome. The shared runtime owns editing and annotations; HTTP owns validated file saves. */
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {EditorStoryRuntime,type StoryController} from '../../../app/lib/story-runtime/EditorStoryRuntime';
import {parseJsx} from '../../../app/lib/jsx';
import {splitHelmet} from '../../../app/lib/story/helmet';
import {useInPlaceEdit} from '../../../app/lib/story/use-in-place-edit';
import type {StoryIslandData} from '../../../app/lib/story-runtime/contract';
import {STORY_DOCUMENT_MESSAGE} from '../../../app/lib/story-runtime/contract';
import type {QueryTransport} from '../../../app/lib/story-runtime/store';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared-runtime';
import type {PreviewComment} from './comments';
import {usePreviewComments} from './use-comments';
import {previewWorkspaceCss} from './workspace-style';
// Keep CodeMirror out of the reader's initial bundle, like the hosted source editor.
const SourcePane=lazy(()=>import('./source-pane').then(module=>({default:module.PreviewSourcePane})));
export interface PreviewDocument {body:string;revision:string;data:StoryIslandData;prepared?:PreparedStoryRuntime;metadata?:{title?:string|null}}
async function api(path:string,body?:unknown){
 const response=await fetch(path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error);return value;
}
export function PreviewWorkspace({initial,file,capture=false}:{initial:PreviewDocument;file:string;capture?:boolean}){
 const [ready,setReady]=useState(!initial.data.dataflow?.flow.queries.length);
 const [document,setDocument]=useState(initial),[source,setSource]=useState(initial.body),[status,setStatus]=useState('Saved locally'),[error,setError]=useState(false);
 const [tab,setTab]=useState<'app'|'code'>('app'),[editing,setEditing]=useState(false),[controller,setController]=useState<StoryController|null>(null),[busy,setBusy]=useState(false);
 const [comments,setComments]=useState<PreviewComment[]>([]),[name,setName]=useState(localStorage.getItem('afbin-preview-name')??''),[text,setText]=useState('');
 const [files,setFiles]=useState<string[]>([]);
 const runtimeRef=useRef<StoryController|null>(null),sourceRef=useRef(source),dirty=useRef(false),revision=useRef(initial.revision),working=useRef(false);
 const commentLayer=usePreviewComments({controller,nodes:document.data.nodes,comments,visible:!capture&&tab==='app'});
 const report=(message:string,failed=false)=>{setStatus(message);setError(failed);};
 const change=(value:string)=>{sourceRef.current=value;dirty.current=true;setSource(value);report('Unsaved changes');};
 const adopt=(next:PreviewDocument)=>{
  revision.current=next.revision;sourceRef.current=next.body;setDocument(next);setSource(next.body);
  runtimeRef.current?.update({type:STORY_DOCUMENT_MESSAGE,nodes:next.data.nodes,dataflow:next.data.dataflow,refData:next.data.refData,...(next.prepared?{compiledCss:next.prepared.compiledCss,authorCss:next.prepared.authorCss,authorScript:next.prepared.authorScript,theme:next.prepared.theme}:{})});
 };
 const edit=useInPlaceEdit({runtimeRef,sourceRef,editing,sessionNonce:controller?.nonce??null,onError:message=>report(message,true),onSourceEdited:next=>{
  change(next);const parsed=parseJsx(next);if(parsed.ok)runtimeRef.current?.update({type:STORY_DOCUMENT_MESSAGE,nodes:splitHelmet(parsed.nodes).body});
 }});
 const onController=useCallback((value:StoryController|null)=>{runtimeRef.current=value;setController(value);},[]);
 const [transport]=useState<QueryTransport>(()=>({run:async(values,only)=>{try{return await api('/query',{file,values,only});}finally{setReady(true);}},page:async(values,name,page)=>{
  const result=await api('/query',{file,values,only:[name],page:{name,...page}});return result.tables[name];
 }}));
 useEffect(()=>{
  if(capture)return;
  void api('/files').then(setFiles).catch(error=>report(error.message,true));
  const unload=(event:BeforeUnloadEvent)=>{if(dirty.current||edit.isUserEditing()){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);
 },[capture]);
 useEffect(()=>{
  if(capture)return;
  let alive=true,inflight=false;
  const poll=async()=>{
   if(inflight)return;inflight=true;
   try{
    const next:PreviewDocument=await api('/document?file='+encodeURIComponent(file));
    if(alive&&next.revision!==revision.current&&!dirty.current&&!working.current&&!edit.isUserEditing()){adopt(next);report('Updated from disk');}
    const rows:PreviewComment[]=await api('/comments?file='+encodeURIComponent(file));
    if(alive)setComments(previous=>JSON.stringify(previous)===JSON.stringify(rows)?previous:rows);
   }catch(error){if(alive)report(error instanceof Error?error.message:String(error),true);}
   finally{inflight=false;}
  };
  void poll();const timer=setInterval(()=>void poll(),1000);return()=>{alive=false;clearInterval(timer);};
 },[capture,file,edit]);
 const save=async()=>{
  if(editing)await edit.commitPending(true);
  const body=sourceRef.current;
  const next:PreviewDocument=await api('/save',{file,revision:revision.current,body});
  revision.current=next.revision;
  if(sourceRef.current!==body){report('New edits waiting to save');throw Error('New edits waiting to save');}
  dirty.current=false;adopt(next);report('Saved locally');return next;
 };
 const action=(run:()=>Promise<unknown>)=>{
  if(working.current)return;working.current=true;setBusy(true);
  void run().catch(error=>report(error instanceof Error?error.message:String(error),true)).finally(()=>{working.current=false;setBusy(false);});
 };
 const latestSave=useRef(()=>action(save));latestSave.current=()=>action(save);
 useEffect(()=>{
  if(capture)return;
  const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();latestSave.current();}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[capture]);
 const switchTab=(next:'app'|'code')=>action(async()=>{
  if(tab===next)return;
  await save();setEditing(false);commentLayer.setPicking(false);setTab(next);
 });
 const toggle=()=>action(async()=>{await save();setEditing(!editing);commentLayer.setPicking(false);});
 const pick=()=>action(async()=>{await save();setEditing(false);commentLayer.setSelection(null);commentLayer.setActive(null);commentLayer.setPicking(true);});
 const comment=()=>action(async()=>{
  const selected=commentLayer.selection;
  if(!selected)throw Error('Select content to comment on.');
  if(!name.trim()||!text.trim())throw Error('Enter your name and comment.');
  await save();
  if(!selected.nodeId)throw Error('Select the content again after saving.');
  const result:PreviewComment=await api('/comments',{file,node:selected.nodeId,name:name.trim(),text:text.trim(),quote:selected.quote,range:selected.range});
  localStorage.setItem('afbin-preview-name',name.trim());setText('');setComments(previous=>[...previous,result]);commentLayer.setSelection(null);commentLayer.setActive(result.id);report('Comment saved locally');
 });
 const runtime=<EditorStoryRuntime data={document.data} prepared={document.prepared} authorScript={document.prepared?.authorScript} transport={transport} onController={onController}/>;
 if(capture)return <div data-afbin-export-ready={ready?'':undefined}>{runtime}</div>;
 return <main className="preview-workspace">
  <style>{previewWorkspaceCss}</style>
  <header className="preview-toolbar">
   <div className="preview-brand"><span className="preview-logo" aria-hidden="true">a</span><div><div className="preview-file">{document.metadata?.title??file.split('/').pop()}</div><div className="preview-local">Local preview</div></div>
    {files.length>1&&<select aria-label="Open file" value={file} onChange={event=>{window.location.href='/workspace/'+event.target.value.split('/').map(encodeURIComponent).join('/');}}>{files.map(path=><option key={path} value={path}>{path}</option>)}</select>}
   </div>
   <div className="preview-tabs" role="tablist" aria-label="Editor view" onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'app':event.key==='End'?'code':tab==='app'?'code':'app';switchTab(next);globalThis.document.getElementById('preview-tab-'+next)?.focus();}}}>
    {(['app','code'] as const).map(value=><button id={'preview-tab-'+value} key={value} role="tab" aria-selected={tab===value} aria-controls={'preview-panel-'+value} tabIndex={tab===value?0:-1} disabled={busy} onClick={()=>switchTab(value)}>{value==='app'?'App':'Code'}</button>)}
   </div>
   <div className="preview-actions"><span role="status" aria-live="polite" className="preview-status" data-error={error}>{busy?'Saving…':status}</span>
    {tab==='app'&&<button disabled={busy} aria-pressed={editing} onClick={toggle}>{editing?'Done editing':'Edit'}</button>}
    {tab==='app'&&<button aria-pressed={commentLayer.open} onClick={()=>commentLayer.setOpen(!commentLayer.open)}>Comments{comments.length?` (${comments.length})`:''}</button>}
    <button className="preview-primary" disabled={busy} onClick={()=>action(save)}>Save file<span className="preview-shortcut">⌘S</span></button>
   </div>
  </header>
  {editing&&tab==='app'&&<div className="preview-format" aria-label="Text formatting"><span>Edit in place</span>{(['strong','em','u'] as const).map((tag,index)=><button key={tag} disabled={!edit.selection} onMouseDown={event=>event.preventDefault()} onClick={()=>edit.applyInline(tag)}>{['Bold','Italic','Underline'][index]}</button>)}</div>}
  <div className="preview-layout">
   <section id="preview-panel-app" role="tabpanel" aria-labelledby="preview-tab-app" className="preview-canvas" hidden={tab!=='app'}>{runtime}</section>
   {tab==='code'&&<section id="preview-panel-code" role="tabpanel" aria-labelledby="preview-tab-code" className="preview-canvas"><div className="preview-codebar"><span>{file}</span><span>JSX · Save to apply</span></div><Suspense fallback={<p>Loading editor…</p>}><SourcePane value={source} onChange={change}/></Suspense></section>}
   {tab==='app'&&commentLayer.open&&<aside className="preview-sidebar" aria-label="Comments">
    <header><h2>Comments</h2><button aria-label="Close comments" onClick={()=>{commentLayer.setOpen(false);commentLayer.setPicking(false);}}>×</button></header>
    <p>Saved on this computer.</p>
    <button disabled={busy} aria-pressed={commentLayer.picking} onClick={pick}>Select content</button>
    {commentLayer.picking&&<p role="status">Click a block or drag across an area in the app. Escape cancels.</p>}
    {commentLayer.selection&&<form className="preview-composer" onSubmit={event=>{event.preventDefault();comment();}}>
     <blockquote>{commentLayer.selection.quote||`${commentLayer.selection.tag} element`}</blockquote>
     <label htmlFor="preview-name">Your name</label><input id="preview-name" maxLength={100} value={name} onChange={event=>setName(event.target.value)}/>
     <label htmlFor="preview-comment">Comment</label><textarea id="preview-comment" autoFocus maxLength={10000} value={text} onChange={event=>setText(event.target.value)} placeholder="Leave a note about this content…"/>
     <button className="preview-primary" disabled={busy||!name.trim()||!text.trim()} type="submit">Post comment</button><button type="button" onClick={()=>commentLayer.setSelection(null)}>Cancel</button>
    </form>}
    {!comments.length&&!commentLayer.selection&&<p className="preview-empty">No comments yet. Select content to leave your first note.</p>}
    {comments.map(item=><article className="preview-thread" data-active={commentLayer.active===item.id} key={item.id}>
     <strong>{item.name}</strong><p>{item.text}</p>{item.quote&&<blockquote>{item.quote}</blockquote>}
     <button disabled={!commentLayer.anchors.has(item.node)} onClick={()=>{commentLayer.setSelection(null);commentLayer.setActive(item.id);}}>{commentLayer.anchors.has(item.node)?'Show in app':'Content removed'}</button>
    </article>)}
   </aside>}
  </div>
  {tab==='app'&&commentLayer.positions.filter(position=>position.rect.y>110&&position.rect.y<window.innerHeight-35).map(position=><button className="preview-marker" key={position.id} aria-label={'Open comment by '+(comments.find(item=>item.id===position.id)?.name??'reviewer')} style={{top:position.rect.y,left:Math.min(position.rect.x+position.rect.width+6,window.innerWidth-(commentLayer.open?352:38))}} onClick={()=>{commentLayer.setOpen(true);commentLayer.setActive(position.id);}}>✎</button>)}
 </main>;
}
