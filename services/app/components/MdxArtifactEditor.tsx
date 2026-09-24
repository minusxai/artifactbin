import {ArtifactParts} from './ArtifactParts';
import {useIsPhoneViewport} from './MobileSheet';
import {APP_BAR_H,LEFT_RAIL_W} from '@/lib/story/edit-bar';
import type {CSSProperties} from 'react';
import type {ArtifactVersionSnapshot} from '@/lib/story/use-versions';
import {TrustedUi} from './TrustedUi';
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

export default function MdxArtifactEditor({id,snapshot,compiledCss,onDone,flushRef,onLeftInsetChange}:{onLeftInsetChange?:(width:number)=>void;id:string;snapshot:DocumentSnapshot;compiledCss:string|null;onDone:()=>void;flushRef:EditorFlushRef}){
 const [session]=useState(()=>new DocumentSession(snapshot,async edit=>{
  const response=await fetch(`/api/documents/${id}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)});
  const result=await response.json();if(!('updated' in result))throw Error(result.detail??result.error??'Could not save');return result as DocumentEditResult;
 }));
 const phone=useIsPhoneViewport(),leftInset=phone?0:LEFT_RAIL_W;
 const [preview,setPreview]=useState<ArtifactVersionSnapshot|null>(null),[historyBusy,setHistoryBusy]=useState(false);
 useEffect(()=>{onLeftInsetChange?.(leftInset);return()=>onLeftInsetChange?.(0);},[leftInset,onLeftInsetChange]);
 const [historyOpen,setHistoryOpen]=useState(false);
 const history=useArtifactVersions({id,currentVersion:session.version});
 const [css,setCss]=useState(compiledCss);
 const [,render]=useState(0);const [source,setSource]=useState<string|null>(null);const [error,setError]=useState('');const live=useRef(true);const sourceDraft=useRef(source);sourceDraft.current=source;
 useEffect(()=>{
  live.current=true;const unsubscribe=session.subscribe(()=>render(n=>n+1));
  flushRef.current=async()=>{try{if(sourceDraft.current!==null)throw Error('Apply your source changes or return to the document first.');await session.drain();}catch(e){setError(e instanceof Error?e.message:'Could not finish saving');throw e;}};
  const timer=setInterval(()=>{if(session.status==='pending')void session.flush();},400);
  void fetch(`/api/documents/${id}`).then(r=>r.ok?r.json():null).then(next=>{if(next&&live.current)session.receive(next);}).catch(()=>{});
  const poll=setInterval(()=>{if(session.status==='saved')void fetch(`/api/documents/${id}`).then(r=>r.ok?r.json():null).then(next=>{if(next&&live.current)session.receive(next);}).catch(()=>{});},2000);
  const unload=(e:BeforeUnloadEvent)=>{if(session.status!=='saved'||sourceDraft.current!==null){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
  return()=>{live.current=false;unsubscribe();clearInterval(timer);clearInterval(poll);flushRef.current=null;window.removeEventListener('beforeunload',unload);};
 },[id,session,flushRef]);
 useEffect(()=>{
  const controller=new AbortController();const timer=setTimeout(()=>{void fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({markup:documentJsx(preview?.document??session.document)}),signal:controller.signal}).then(r=>r.ok?r.json():null).then(body=>{if(typeof body?.css==='string')setCss(body.css);}).catch(()=>{});},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[session.document,preview]);
 function download(){const url=URL.createObjectURL(new Blob([serializeDocumentMdx(session.document)],{type:'text/mdx'}));const a=document.createElement('a');a.href=url;a.download='document.mdx';a.click();URL.revokeObjectURL(url);}

 async function previewVersion(version:number){
  try{if(sourceDraft.current!==null)throw Error('Apply your source changes or return to the document first.');await session.drain();const next=await history.fetchVersion(version);if(!next?.document)throw Error('Could not load this version.');setPreview(next);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load this version.');}
 }
 async function restoreVersion(version:number){
  setHistoryBusy(true);
  try{await session.drain();const next=preview?.version===version?preview:await history.fetchVersion(version);if(!next?.document)throw Error('Could not load this version.');session.update(next.document);await session.drain();setPreview(null);await history.refresh();setError('');}catch(e){setError(e instanceof Error?e.message:'Could not restore this version.');}finally{setHistoryBusy(false);}
 }
 function finish(){if(source!==null){setError('Apply your source changes or return to the document first.');return;}void Promise.resolve(onDone()).catch(()=>{});}
 function switchMode(mode:'design'|'code'){
  if(mode==='code'){setPreview(null);setSource(serializeDocumentMdx(session.document,false));}
  else if(source!==null){try{session.update(reparseDocumentMdx(session.document,source));setSource(null);setError('');}catch(e){setError(e instanceof Error?e.message:'Invalid MDX');}}
 }
 const versionList=<VersionHistory embedded={!phone} versions={history.versions} currentVersion={session.version} previewing={preview?.version??null} onPreview={version=>void previewVersion(version)} onRestore={version=>void restoreVersion(version)} onBackToCurrent={()=>setPreview(null)} onClose={()=>setHistoryOpen(false)} busy={historyBusy} topOffset={132}/>;
 return <div className="mdx-artifact-editor" style={{'--mdx-left-inset':`${leftInset}px`} as CSSProperties}>
  {css&&<style>{css}</style>}
  <TrustedUi overlay>{!phone&&<ArtifactParts top={APP_BAR_H} mode={source===null?'design':'code'} onModeChange={switchMode} onDone={finish}>{versionList}</ArtifactParts>}{phone&&historyOpen&&versionList}</TrustedUi>
  <div className="mdx-document-actions"><span className="mdx-save-state" role="status">{preview?`Previewing v${preview.version}`:session.status==='saved'?'All changes saved':['pending','saving'].includes(session.status)?'Saving…':'Draft preserved'}</span>{phone&&<><button aria-label="Edit the source" onClick={()=>switchMode(source===null?'code':'design')}>Code</button><button aria-label="Open version history" onClick={()=>setHistoryOpen(v=>!v)}>History</button></>}<button onClick={download}>Export</button><button aria-label="Exit edit mode" className="mdx-done" onClick={finish}>Done</button></div>
  {(error||session.detail)&&<div className="mdx-save-error" role="alert">{error||session.detail}{session.status==='offline'&&<button onClick={()=>void session.flush()}>Retry save</button>}<button onClick={download}>Download draft</button></div>}
  {source===null?<DocumentEditor document={preview?.document??session.document} artifactId={preview?undefined:id} editable={!preview} onChange={next=>session.update(next)}/>:<section className="mdx-source-panel"><textarea aria-label="MDX source" value={source} onChange={e=>setSource(e.target.value)}/><button onClick={()=>switchMode('design')}>Apply MDX</button></section>}
 </div>;
}
