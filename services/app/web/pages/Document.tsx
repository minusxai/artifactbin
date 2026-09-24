import {useEffect,useRef,useState} from 'react';
import {Navigate,useNavigate,useParams} from 'react-router';
import type {DocumentEditResult,DocumentSnapshot,RichDocument} from '@artifactbin/contracts';
import {DocumentEditor} from '@/components/DocumentEditor';
import {parseDocumentMdx,reparseDocumentMdx,serializeDocumentMdx} from '@/lib/document/mdx';
import {DocumentSession} from '@/lib/document/session';

const example=`# A document you can shape

Write here. Select **a few words** to change their font, or use the toolbar to add a layout.

<Flex direction="row" sizes={[2,1]}>

<div>

## Room for an idea

This text lives inside a layout. Enter splits a paragraph; Backspace joins it. Try moving a block between columns.

</div>

<div>

## Beside it

Drag a divider to change the proportions.

</div>

</Flex>

<div className="p-6 bg-slate-50 rounded-lg" width={360}>

### Make it yours

Keep writing Markdown inside a styled block. Resize it, change its class, or float it beside your text.

</div>

Ordinary paragraphs remain Markdown. Components keep their properties, and selected text can carry a span class. The rendered document is where you edit.
`;
type PageDocument=DocumentSnapshot&{title?:string;editable?:boolean};
async function read(id:string):Promise<PageDocument>{const response=await fetch(`/api/documents/${id}`,{credentials:'same-origin'});if(!response.ok)throw Error('This document is unavailable.');return response.json();}
export function DocumentPage(){
 const {id}=useParams();const navigate=useNavigate();
 const [document,setDocument]=useState<RichDocument>(()=>parseDocumentMdx(example));const draft=useRef(document);draft.current=document;
 const [title,setTitle]=useState('Untitled document'),[status,setStatus]=useState('Not saved'),[error,setError]=useState(''),[editable,setEditable]=useState(!id),[loading,setLoading]=useState(!!id);
 const [source,setSource]=useState<string|null>(null);const session=useRef<DocumentSession|null>(null);const detach=useRef<(()=>void)|null>(null);const adopted=useRef<string|null>(null);
 function attach(snapshot:PageDocument){
  detach.current?.();const editing=new DocumentSession(snapshot,async edit=>{
   const response=await fetch(`/api/documents/${snapshot.id}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)});
   const body=await response.json();if(!('updated'in body))throw Error(body.detail??body.error??'Could not save.');return body as DocumentEditResult;
  });session.current=editing;
  detach.current=editing.subscribe(()=>{setStatus(editing.status);setError(editing.detail);setDocument(editing.document);});
  setDocument(snapshot.document);setTitle(snapshot.title??title);setEditable(snapshot.editable??true);setStatus('saved');
 }
 useEffect(()=>{
  if(!id||adopted.current===id){setLoading(false);return;}
  let cancelled=false;setLoading(true);void read(id).then(snapshot=>{if(!cancelled){attach(snapshot);setLoading(false);}}).catch(e=>{if(!cancelled){setError(e.message);setLoading(false);}});
  return()=>{cancelled=true;};
 },[id]);
 useEffect(()=>{
  const timer=setInterval(()=>{const current=session.current;if(current?.status==='pending')void current.flush();},500);
  const poll=setInterval(()=>{if(id&&session.current?.status==='saved')void read(id).then(snapshot=>{session.current?.receive(snapshot);setEditable(snapshot.editable??false);}).catch(()=>{});},2000);
  const beforeUnload=(e:BeforeUnloadEvent)=>{if(session.current&&session.current.status!=='saved'){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  return()=>{clearInterval(timer);clearInterval(poll);window.removeEventListener('beforeunload',beforeUnload);};
 },[id]);
 useEffect(()=>()=>{detach.current?.();},[]);
 function change(next:RichDocument){setDocument(next);session.current?.update(next);}
 async function create(){
  setStatus('Saving');setError('');const sent=draft.current;
  try{
   const response=await fetch('/api/documents',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,document:sent})});const result=await response.json();
   if(!response.ok)throw Error(result.detail??(response.status===401?'Sign in to save this document.':result.error));
   const buffered=draft.current;attach({...result,title,editable:true});if(buffered!==sent)session.current?.update(buffered);adopted.current=result.id;void navigate(`/a/${result.id}#edit`,{replace:true});
  }catch(e){setStatus('Not saved');setError(e instanceof Error?e.message:'Could not save.');}
 }
 function download(){const blob=new Blob([serializeDocumentMdx(document)],{type:'text/mdx'});const url=URL.createObjectURL(blob);const a=window.document.createElement('a');a.href=url;a.download=`${title||'document'}.mdx`;a.click();URL.revokeObjectURL(url);}
 if(id)return <Navigate to={`/a/${id}#edit`} replace/>;
 if(loading)return <p role="status">Loading document…</p>;
 return <main style={{maxWidth:1200,margin:'0 auto',background:'var(--surface,#fff)',minHeight:'100vh'}}>
  <header style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',padding:'20px 28px',borderBottom:'1px solid #dce0e5'}}>
   <input aria-label="Document title" value={title} readOnly={!!id} onChange={e=>setTitle(e.target.value)} style={{fontSize:18,fontWeight:600,flex:1,minWidth:180,background:'transparent'}}/>
   <span role="status" style={{fontSize:13,color:'#64748b'}}>{status==='saved'?'All changes saved':status==='saving'||status==='pending'?'Saving…':status}</span>
   {!id&&<button onClick={()=>void create()} disabled={status==='Saving'}>Save document</button>}
   <button onClick={()=>setSource(source===null?serializeDocumentMdx(document,false):null)}>{source===null?'MDX source':'Back to document'}</button>
   <button onClick={download}>Export MDX</button>
   {id&&<button onClick={()=>void navigator.clipboard.writeText(window.location.href)}>Copy link</button>}
  </header>
  {error&&<div role="alert" style={{padding:16,background:'#fff2df'}}>{error}{status==='offline'&&<button onClick={()=>void session.current?.flush()}>Retry save</button>}{status==='conflict'&&<><button onClick={download}>Download my draft</button><button onClick={()=>void create()}>Save draft as a new document</button></>}</div>}
  {source!==null?<section style={{padding:24}}><textarea aria-label="MDX source" value={source} readOnly={!editable} onChange={e=>setSource(e.target.value)} style={{width:'100%',minHeight:'60vh',fontFamily:'monospace',padding:16}}/>{editable&&<button onClick={()=>{try{const next=reparseDocumentMdx(document,source);change(next);setSource(null);setError('');}catch(e){setError(e instanceof Error?e.message:'Invalid MDX');}}}>Apply MDX</button>}</section>:<DocumentEditor artifactId={id} document={document} editable={editable} onChange={change}/>}
 </main>;
}
