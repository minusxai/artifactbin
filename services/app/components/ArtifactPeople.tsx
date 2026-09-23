import {useEffect,useState} from 'react';
import {Users} from 'lucide-react';
import type {MembershipInput,MembershipState} from '@artifactbin/contracts';
import {Button,Input} from './ui';
type Person={user_id:string;username:string;name:string|null};
export function ArtifactPeople({artifactId,revision=0,onChange}:{artifactId:string;revision?:number;onChange?:()=>void}){
 const [open,setOpen]=useState(false),[state,setState]=useState<MembershipState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [query,setQuery]=useState(''),[candidates,setCandidates]=useState<Person[]>([]),[selected,setSelected]=useState<Person[]>([]);
 const endpoint=`/api/my/artifacts/${encodeURIComponent(artifactId)}/members`;
 useEffect(()=>{if(!open)return;const abort=new AbortController();void fetch(endpoint,{signal:abort.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw Error(result.detail??'Could not load people');setState(result);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[endpoint,open,revision]);
 useEffect(()=>{if(!open||!state?.canInvite)return;const abort=new AbortController();void fetch(`${endpoint}?query=${encodeURIComponent(query)}`,{signal:abort.signal}).then(r=>r.json()).then(r=>setCandidates(r.people??[])).catch(()=>{});return()=>abort.abort();},[endpoint,query,open,state?.canInvite]);
 const act=async(input:MembershipInput)=>{setBusy(true);setError('');try{const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await res.json();if(!res.ok)throw Error(result.detail??'Could not update people');setState(result);onChange?.();if(input.action==='invite'){setSelected([]);setQuery('');}}catch(e){setError(e instanceof Error?e.message:'Could not update people');}finally{setBusy(false);}};
 return <section aria-label="Artefact people" className="space-y-3">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-raised"><Users size={16}/><span>People</span>{state&&<span className="ml-auto text-xs text-muted">{state.members.length}</span>}</button>
  {open&&<div className="space-y-4 rounded-xl border border-edge bg-surface p-4">
   <div><h3 className="font-medium">People in this artefact</h3><p className="mt-1 text-xs leading-5 text-muted">Join to use its data actions.</p><p className="text-xs leading-5 text-muted">Comment access does not depend on joining.</p></div>
   {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
   {!state&&!error&&<p role="status">Loading people…</p>}
   {state&&<>
    {state.self?.status==='accepted'?<div className="flex items-center justify-between gap-2"><span className="text-xs text-accent">You’re a member</span><Button variant="ghost" disabled={busy} onClick={()=>void act({action:'leave'})}>Leave</Button></div>:state.self?.status==='pending'?<div className="space-y-2 rounded-lg bg-raised p-3"><p className="text-xs">{state.self.direction==='request'?'Waiting for an owner or editor to approve.':'You’ve been invited to join.'}</p><div className="flex gap-2">{state.self.direction==='invitation'&&<Button disabled={busy} onClick={()=>void act({action:'accept'})}>Accept invitation</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void act({action:'dismiss'})}>{state.self.direction==='request'?'Withdraw request':'Decline'}</Button></div></div>:<Button disabled={busy} onClick={()=>void act({action:'join'})}>{state.canManage?'Join artefact':'Request to join'}</Button>}
    <ul className="divide-y divide-edge">{state.members.map(m=><li key={m.user_id} className="flex items-center gap-3 py-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs text-accent">{(m.name??m.username??'?').slice(0,1).toUpperCase()}</span><span className="min-w-0 truncate text-sm">{m.username?`@${m.username}`:m.name??m.user_id}</span><span className="ml-auto text-xs text-muted">Member</span></li>)}</ul>
    {state.canManage&&state.pending.filter(m=>m.user_id!==state.self?.user_id).map(m=><div key={m.user_id} className="space-y-2 rounded-lg border border-edge p-3"><p className="text-xs">@{m.username??m.user_id} · {m.direction==='invitation'?'Invitation pending':'Wants to join'}</p><div className="flex gap-2">{m.direction==='request'&&<Button disabled={busy} onClick={()=>void act({action:'approve',userId:m.user_id})}>Approve @{m.username??m.user_id}</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void act({action:'dismiss',userId:m.user_id})}>Dismiss</Button></div></div>)}
    {state.canInvite&&<div className="space-y-2 border-t border-edge pt-4"><label className="grid gap-2 text-xs font-medium">Add people<Input aria-label="Find people by username" value={query} placeholder="@username" onChange={e=>setQuery(e.target.value)}/></label><p className="text-xs leading-5 text-muted">People who follow you and existing members appear here.</p>
     <div className="flex flex-wrap gap-1">{selected.map(p=><button type="button" key={p.user_id} className="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent" aria-label={`Remove @${p.username}`} onClick={()=>setSelected(selected.filter(s=>s.user_id!==p.user_id))}>@{p.username} ×</button>)}</div>
     <ul className="max-h-36 overflow-auto">{candidates.filter(p=>!selected.some(s=>s.user_id===p.user_id)).map(p=><li key={p.user_id}><button type="button" className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-raised" onClick={()=>setSelected([...selected,p])}>@{p.username}<span className="ml-2 text-xs text-muted">{p.name}</span></button></li>)}</ul>
     <Button disabled={busy||!selected.length} onClick={()=>void act({action:'invite',usernames:selected.map(p=>`@${p.username}`)})}>Invite{selected.length?` ${selected.length} people`:''}</Button><p className="text-xs leading-5 text-muted">Followers join immediately unless they’ve turned off automatic acceptance. Others see a pending invitation.</p>
    </div>}
   </>}
  </div>}
 </section>;
}
