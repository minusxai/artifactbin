import {useEffect,useId,useState} from 'react';
import {Users} from 'lucide-react';
import type {MembershipInput,MembershipState} from '@artifactbin/contracts';
import {Button,Input} from './ui';
type Person={user_id:string;username:string;name:string|null};
export function ArtifactPeople({artifactId,revision=0,onChange,hideJoin=false,initialOpen=false}:{artifactId:string;revision?:number;onChange?:()=>void;hideJoin?:boolean;initialOpen?:boolean}){
 const [open,setOpen]=useState(initialOpen),[state,setState]=useState<MembershipState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(initialOpen)setOpen(true);},[initialOpen]);
 const [selected,setSelected]=useState<Person[]>([]),[includeAccess,setIncludeAccess]=useState(false);
 const endpoint=`/api/my/artifacts/${encodeURIComponent(artifactId)}/members`;
 useEffect(()=>{const abort=new AbortController();void fetch(endpoint,{signal:abort.signal}).then(async r=>{const result=await r.json();if(!r.ok||!Array.isArray(result.members)||!Array.isArray(result.pending))throw Error(result.detail??'Could not load people');setState(result);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[endpoint,open,revision]);

 const act=async(input:MembershipInput)=>{setBusy(true);setError('');try{const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await res.json();if(!res.ok||!Array.isArray(result.members)||!Array.isArray(result.pending))throw Error(result.detail??'Could not update people');setState(result);onChange?.();if(input.action==='invite'){setSelected([]);}}catch(e){setError(e instanceof Error?e.message:'Could not update people');}finally{setBusy(false);}};
 return <section aria-label="artifact people" className="space-y-3">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-raised"><Users size={16}/><span>People</span>{state?.self?.status==='accepted'&&state.self.explicit_join&&<span className="text-xs text-accent">Joined</span>}{state&&<span className="ml-auto text-xs text-muted">{state.members.length}</span>}</button>
  {open&&<div className="space-y-4 rounded-xl border border-edge bg-surface p-4">
   <div><h3 className="font-medium">People in this artifact</h3><p className="text-xs leading-5 text-muted">Comment access does not depend on joining.</p></div>
   {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
   {!state&&!error&&<p role="status">Loading people…</p>}
   {state&&<>
    {state.self?.status==='accepted'?<div className="flex items-center justify-between gap-2"><span className="text-xs text-accent">{state.self.explicit_join?'You’re a member':'Invitation automatically accepted'}</span>{!state.self.explicit_join&&<Button disabled={busy} onClick={()=>void act({action:'join'})}>Join artifact</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void act({action:'leave'})}>Leave</Button></div>:state.self?.status==='pending'?<div className="space-y-2 rounded-lg bg-raised p-3"><p className="text-xs">{state.self.direction==='request'?'Waiting for an owner or editor to approve.':'You’ve been invited to join.'}</p><div className="flex gap-2">{(state.self.direction==='invitation'||state.canManage)&&<Button disabled={busy} onClick={()=>void act({action:state.canManage&&state.self?.direction==='request'?'join':'accept'})}>{state.canManage&&state.self.direction==='request'?'Join artifact':'Accept invitation'}</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void act({action:'dismiss'})}>{state.self.direction==='request'?'Withdraw request':'Decline'}</Button></div></div>:hideJoin?null:<Button disabled={busy} onClick={()=>void act({action:'join'})}>{state.canManage?'Join artifact':'Request to join'}</Button>}
    <ul className="divide-y divide-edge">{state.members.map(m=><li key={m.user_id} className="flex items-center gap-3 py-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs text-accent">{(m.name??m.username??'?').slice(0,1).toUpperCase()}</span><span className="min-w-0 truncate text-sm">{m.username?`@${m.username}`:m.name??m.user_id}</span><span className="ml-auto text-xs text-muted">Member</span></li>)}</ul>
    {state.canManage&&state.pending.filter(m=>m.user_id!==state.self?.user_id).map(m=><div key={m.user_id} className="space-y-2 rounded-lg border border-edge p-3"><p className="text-xs">@{m.username??m.user_id} · {m.direction==='invitation'?'Invitation pending':'Wants to join'}</p><div className="flex gap-2">{m.direction==='request'&&<Button disabled={busy} onClick={()=>void act({action:'approve',userId:m.user_id})}>Approve @{m.username??m.user_id}</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void act({action:'dismiss',userId:m.user_id})}>Dismiss</Button></div></div>)}
    {state.canInvite&&<div className="space-y-2 border-t border-edge pt-4"><PeopleInvitePicker endpoint={endpoint} selected={selected} onSelect={person=>setSelected([...selected,person])}/><p className="text-xs leading-5 text-muted">Find anyone by username. Invitations wait for acceptance unless they follow you.</p>
     <div className="flex flex-wrap gap-1">{selected.map(p=><button type="button" key={p.user_id} className="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent" aria-label={`Remove @${p.username}`} onClick={()=>setSelected(selected.filter(s=>s.user_id!==p.user_id))}>@{p.username} ×</button>)}</div>

     {state.canManage&&<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeAccess} onChange={e=>setIncludeAccess(e.target.checked)}/>Include viewing access</label>}
     <Button disabled={busy||!selected.length} onClick={()=>void act({action:'invite',usernames:selected.map(p=>`@${p.username}`),includeAccess})}>Invite{selected.length?` ${selected.length} people`:''}</Button><p className="text-xs leading-5 text-muted">Followers join immediately unless they’ve turned off automatic acceptance. Others see a pending invitation.</p>
    </div>}
   </>}
  </div>}
 </section>;
}

/** Owns invitation lookup and its keyboard interaction; selecting never sends an invite. */
function PeopleInvitePicker({ endpoint, selected, onSelect }: {
 endpoint: string; selected: Person[]; onSelect: (person: Person) => void;
}) {
 const id = useId();
 const [query, setQuery] = useState('');
 const [open, setOpen] = useState(false);
 const [candidates, setCandidates] = useState<Person[]>([]);
 const [active, setActive] = useState(-1);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState('');
 const options = candidates.filter(person => !selected.some(item => item.user_id === person.user_id));
 useEffect(() => {
  if (!open) return;
  const abort = new AbortController();
  setLoading(true); setError(''); setCandidates([]); setActive(-1);
  void fetch(`${endpoint}?purpose=invite&query=${encodeURIComponent(query)}`, { signal: abort.signal })
   .then(async response => {
    if (!response.ok) throw new Error('Could not find people. Try again.');
    const result = await response.json();
    if (!abort.signal.aborted) setCandidates(result.people ?? []);
   })
   .catch(() => { if (!abort.signal.aborted) setError('Could not find people. Try again.'); })
   .finally(() => { if (!abort.signal.aborted) setLoading(false); });
  return () => abort.abort();
 }, [endpoint, query, open]);
 const select = (person: Person) => { onSelect(person); setQuery(''); setOpen(false); setActive(-1); };
 return <div className="relative" onBlur={event => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
 }}>
  <label className="grid gap-2 text-xs font-medium">Add people
   <Input role="combobox" aria-label="Find people by username" aria-autocomplete="list" aria-expanded={open}
    aria-controls={open ? id : undefined} aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
    value={query} placeholder="@username" autoComplete="off"
    onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
    onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
    onKeyDown={event => {
     if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
     else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      setActive(current => !options.length ? -1 : current < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
     } else if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); select(options[active]); }
    }}/>
  </label>
  {open && <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-edge bg-surface shadow-lg">
   <ul id={id} role="listbox" aria-label="People suggestions" className="max-h-48 overflow-y-auto p-1">
    {options.map((person, index) => <li key={person.user_id} role="presentation">
     <button type="button" role="option" id={`${id}-${index}`} aria-selected={active === index} tabIndex={-1}
      className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-raised ${active === index ? 'bg-raised' : ''}`}
      onMouseDown={event => event.preventDefault()} onClick={() => select(person)}>
      @{person.username}{' '}<span className="ml-2 text-xs text-muted">{person.name}</span>
     </button>
    </li>)}
   </ul>
   {(loading || error || options.length === 0) && <p role="status" className="px-3 py-2 text-xs text-muted">{loading ? 'Finding people…' : error || 'No people found.'}</p>}
  </div>}
 </div>;
}
