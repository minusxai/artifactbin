import VersionHistory from './VersionHistory';
import {useArtifactVersions} from '@/lib/story/use-versions';
import {documentJsx} from '@/lib/document/markup';
/** Artifact-shell adapter. One session owns persistence; Done drains all buffered edits. */
import {useEffect,useRef,useState} from 'react';
import type {DocumentEditResult,DocumentSnapshot} from '@artifactbin/contracts';
import type {EditorFlushRef} from '@/lib/story/use-live-edits';
import {DocumentSession} from '@/lib/document/session';
import {DocumentEditor} from './DocumentEditor';
import {reparseDocumentMdx,serializeDocumentMdx} from '@/lib/document/mdx';

export default function MdxArtifactEditor({id,snapshot,compiledCss,onDone,flushRef}:{id:string;snapshot:DocumentSnapshot;compiledCss:string|null;onDone:()=>void;flushRef:EditorFlushRef}){
 const [session]=useState(()=>new DocumentSession(snapshot,async edit=>{
  const response=await fetch(`/api/documents/${id}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)});
  const result=await response.json();if(!('updated' in result))throw Error(result.detail??result.error??'Could not save');return result as DocumentEditResult;
 }));
 const [historyOpen,setHistoryOpen]=useState(false);
 const history=useArtifactVersions({id,currentVersion:session.version});
 const [css,setCss]=useState(compiledCss);
 const [,render]=useState(0);const [source,setSource]=useState<string|null>(null);const [error,setError]=useState('');const live=useRef(true);
 useEffect(()=>{
  live.current=true;const unsubscribe=session.subscribe(()=>render(n=>n+1));
  flushRef.current=async()=>{try{await session.drain();}catch(e){setError(e instanceof Error?e.message:'Could not finish saving');throw e;}};
  const timer=setInterval(()=>{if(session.status==='pending')void session.flush();},400);
  void fetch(`/api/documents/${id}`).then(r=>r.ok?r.json():null).then(next=>{if(next&&live.current)session.receive(next);}).catch(()=>{});
  const poll=setInterval(()=>{if(session.status==='saved')void fetch(`/api/documents/${id}`).then(r=>r.ok?r.json():null).then(next=>{if(next&&live.current)session.receive(next);}).catch(()=>{});},2000);
  const unload=(e:BeforeUnloadEvent)=>{if(session.status!=='saved'){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
  return()=>{live.current=false;unsubscribe();clearInterval(timer);clearInterval(poll);flushRef.current=null;window.removeEventListener('beforeunload',unload);};
 },[id,session,flushRef]);
 useEffect(()=>{
  const controller=new AbortController();const timer=setTimeout(()=>{void fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({markup:documentJsx(session.document)}),signal:controller.signal}).then(r=>r.ok?r.json():null).then(body=>{if(typeof body?.css==='string')setCss(body.css);}).catch(()=>{});},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[session.document]);
 function download(){const url=URL.createObjectURL(new Blob([serializeDocumentMdx(session.document)],{type:'text/mdx'}));const a=document.createElement('a');a.href=url;a.download='document.mdx';a.click();URL.revokeObjectURL(url);}
 return <div className="mdx-artifact-editor">
  {css&&<style>{css}</style>}
  <div className="mdx-document-actions"><span className="mdx-save-state" role="status">{session.status==='saved'?'All changes saved':['pending','saving'].includes(session.status)?'Saving…':'Draft preserved'}</span><button onClick={()=>setSource(source===null?serializeDocumentMdx(session.document,false):null)}>{source===null?'MDX source':'Back to document'}</button><button onClick={()=>setHistoryOpen(v=>!v)}>History</button><button onClick={download}>Export</button><button className="mdx-done" onClick={()=>{if(source!==null){setError('Apply your source changes or return to the document first.');return;}void Promise.resolve(onDone()).catch(()=>{});}}>Done</button></div>
  {(error||session.detail)&&<div className="mdx-save-error" role="alert">{error||session.detail}{session.status==='offline'&&<button onClick={()=>void session.flush()}>Retry save</button>}<button onClick={download}>Download draft</button></div>}
  {historyOpen&&<VersionHistory versions={history.versions} currentVersion={session.version} previewing={null} onPreview={version=>window.open(`/a/${id}?version=${version}`,'_blank','noopener')} onRestore={()=>{}} onBackToCurrent={()=>setHistoryOpen(false)} onClose={()=>setHistoryOpen(false)} busy={false} topOffset={132}/>}
  {source===null?<DocumentEditor document={session.document} artifactId={id} onChange={next=>session.update(next)}/>:<section className="mdx-source-panel"><textarea aria-label="MDX source" value={source} onChange={e=>setSource(e.target.value)}/><button onClick={()=>{try{session.update(reparseDocumentMdx(session.document,source));setSource(null);setError('');}catch(e){setError(e instanceof Error?e.message:'Invalid MDX');}}}>Apply MDX</button></section>}
 </div>;
}
