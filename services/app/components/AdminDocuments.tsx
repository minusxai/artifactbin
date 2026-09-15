import {useCallback,useState} from 'react';
import {useNavigationGuard} from '@/web/NavigationBoundary';
import {ADMIN_DOCUMENT_HEADER,type AdminDocument,type AdminDocumentList} from '@artifactbin/contracts';

/** Source is always a textarea value. This surface never executes or previews authored markup. */
export default function AdminDocuments() {
  const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[list,setList]=useState<AdminDocumentList>({documents:[],next:null});
  const [doc,setDoc]=useState<AdminDocument|null>(null),[source,setSource]=useState(''),[reason,setReason]=useState('');
  const [status,setStatus]=useState('');
  const request=async<T,>(path:string,method='GET',body?:unknown):Promise<T>=>{
    const response=await fetch('/api/admin/documents'+path,{method,credentials:'same-origin',headers:{[ADMIN_DOCUMENT_HEADER]:'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error==='version_conflict'?'version_conflict: this document changed. Your draft is preserved; inspect the latest version before retrying.':result.error??'Request failed');
    return result;
  };
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setStatus('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}};
  const search=(after?:string)=>run(async()=>{const result=await request<AdminDocumentList>('?'+new URLSearchParams({q:query,...(after?{after}:{})}));setList(previous=>after?{...result,documents:[...previous.documents,...result.documents]}:result);});
  const inspect=(id:string)=>run(async()=>{const result=await request<AdminDocument>('/'+encodeURIComponent(id));setDoc(result);setSource(result.source);setReason('');});
  const save=()=>run(async()=>{
    if(!doc)return;
    const result=await request<AdminDocument>('/'+encodeURIComponent(doc.id),'PUT',{source,edit_id:doc.edit_id,reason});
    setDoc(result);setSource(result.source);setStatus(`Published version ${result.version}.`);
  });
  const dirty=!!doc && source!==doc.source;
  const guard=useCallback(async()=>{setError('Publish or discard your draft before leaving document administration.');return false;},[]);
  useNavigationGuard(dirty||busy?guard:null);
  return <section className="mt-8 border-t border-border pt-6" aria-label="Document administration">
    <h2 className="text-base font-semibold">Document administration</h2>
    {!active?<button className="mt-3 underline" onClick={()=>{setActive(true);void search();}}>Enter admin mode</button>:<>
      <div className="my-3 flex items-center justify-between gap-4"><strong>Admin mode · source inspection and repair</strong><button disabled={busy||dirty} onClick={()=>{setActive(false);setDoc(null);setSource('');setList({documents:[],next:null});setError('');setStatus('');}}>Leave admin mode</button></div>
      <p className="text-sm text-muted">Reads and repairs are audited under your account. Document scripts do not run here.</p>
      <form className="my-4 flex gap-2" onSubmit={e=>{e.preventDefault();void search();}}><input aria-label="Search document titles and source" className="min-w-0 flex-1 border border-border bg-background p-2" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} /><button disabled={busy}>Search</button></form>
      <ul className="space-y-2">{list.documents.map(row=><li key={row.id}><button disabled={busy||dirty} className="underline" aria-label={`Inspect ${row.title??row.id}`} onClick={()=>void inspect(row.id)}>{row.title??row.id}</button> <span className="text-xs text-muted">{row.id} · v{row.version}</span></li>)}</ul>
      {list.next&&<button disabled={busy} onClick={()=>void search(list.next!)}>Load more</button>}
      {doc&&<form className="mt-5 space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
        <h3>{doc.title??doc.id} · version {doc.version}</h3>
        <label className="block">Document source<textarea aria-label="Document source" className="mt-1 block min-h-80 w-full border border-border bg-background p-3 font-mono text-xs" value={source} disabled={busy} onChange={e=>setSource(e.target.value)} spellCheck={false} /></label>
        <label className="block">Repair reason<input aria-label="Repair reason" className="mt-1 block w-full border border-border bg-background p-2" required maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} /></label>
        <div className="flex gap-4"><button type="submit" disabled={busy||!reason.trim()||!dirty}>Publish repair</button><button type="button" disabled={busy} onClick={()=>setSource(doc.source)}>Discard draft</button></div>
      </form>}
    </>}
    {error&&<p role="alert" className="mt-3 text-destructive">{error}</p>}{status&&<p role="status" className="mt-3">{status}</p>}
  </section>;
}
