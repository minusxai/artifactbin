import {useEffect,useRef,useState} from 'react';
import {Bell,Check,ShieldBan} from 'lucide-react';
import {Button,timeAgo} from './ui';
import Avatar from './Avatar';
import RowMenu from './RowMenu';
import {useNotificationInbox} from './use-notification-inbox';
import type {InboxItem} from './notification-context';

function destination(n:InboxItem){
 if(n.kind==='follow')return `/people/${n.sender_id}`;
 const target=n.source?.startsWith('node:')?`#${n.source.slice(5)}`:n.source?.startsWith('comment:')?`?thread=${n.source.slice(8)}${n.first_update_id?`&comment=${encodeURIComponent(n.first_update_id)}`:''}`:'';
 return `/a/${n.artifact_id}${target}`;
}
const actionText:Record<string,string>={request:'asked to join',invitation:'invited you to',joined:'added you to',follow:'followed you',like:'liked',reply_resolved:'replied and resolved your comment in',reply:'replied in',resolved:'resolved a comment in',reopened:'reopened a comment in'};

/** One notification row for the compact menu and the full history. */
function NotificationRow({item:n,busy,onRead,onRespond,onBlock}:{item:InboxItem;busy:boolean;onRead:()=>void;onRespond:(action:'accept'|'approve'|'dismiss')=>void;onBlock:()=>void}){
 const invitation=n.kind==='invitation'||n.kind==='request'||n.kind==='joined'||(n.source?.startsWith('comment:')&&n.direction==='invitation');
 return <li data-notification-id={n.id} className={`relative flex gap-3 px-3 py-3.5 ${n.read_at?'':'bg-accent-soft/40'}`}>
  <div className="pt-0.5"><Avatar image={null} initial={n.username??'?'} userId={n.sender_id} size={32}/></div>
  <div className="min-w-0 flex-1">
   <a className="block break-words text-sm leading-5 text-fg hover:text-accent" href={destination(n)} onClick={onRead}><span className="font-semibold">@{n.username??'someone'}</span>{' '}{actionText[n.kind]??'mentioned you in'}{n.kind!=='follow'&&<> <span className="font-semibold">{n.title??'Untitled artefact'}</span></>}</a>
   {n.created_at&&<time dateTime={n.created_at} className="mt-1 block text-xs text-muted">{timeAgo(n.created_at)}</time>}
   {n.status==='pending'&&invitation&&<div className="mt-2 flex gap-2"><Button disabled={busy} onClick={()=>onRespond(n.direction==='request'?'approve':'accept')}>{n.direction==='request'?'Approve request':'Accept invitation'}</Button><Button variant="ghost" disabled={busy} onClick={()=>onRespond('dismiss')}>Dismiss</Button></div>}
   {n.status==='accepted'&&invitation&&<div className="mt-2 space-y-1"><p role="status" className="flex items-start gap-1 text-xs leading-5 text-accent"><Check size={14} className="mt-0.5 shrink-0"/>{n.kind==='request'?'Approved — this person has joined the artefact.':n.kind==='invitation'?'Accepted — you’ve joined this artefact.':'You’ve joined this artefact.'}</p><a onClick={onRead} className="text-xs text-muted underline underline-offset-2 hover:text-fg" href={`/a/${n.artifact_id}`}>Open artefact</a></div>}
  </div>
  <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
   {!n.read_at&&<span aria-label="Unread" className="h-1.5 w-1.5 rounded-full bg-accent"/>}
   <RowMenu name={`notification from @${n.username??'someone'}`} items={[{label:`Block @${n.username??'sender'}`,text:'Block sender',icon:<ShieldBan size={13}/>,disabled:busy,onSelect:onBlock}]}/>
  </div>
 </li>;
}

export function PeopleInbox({compact=false}:{compact?:boolean}){
 const {state,error,load,loadMore,close}=useNotificationInbox();
 const root=useRef<HTMLElement>(null),displayed=useRef<Map<string,number>|null>(null),read=useRef(new Set<string>());
 const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
 const items=compact?state?.notifications.slice(0,6):state?.notifications;
 async function respond(n:InboxItem,action:'accept'|'approve'|'dismiss'){
  if(!n.artifact_id)return;
  setBusy(true);setActionError('');
  try{
   const res=await fetch(`/api/my/artifacts/${encodeURIComponent(n.artifact_id)}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(n.direction==='request'?{userId:n.user_id}:{})})});
   if(!res.ok){const result=await res.json();throw Error(result.detail??'Could not update invitation');}
   await load({read:n.id,revision:n.revision});
  }catch(e){setActionError(e instanceof Error?e.message:'Could not update invitation');}finally{setBusy(false);}
 }
 useEffect(()=>{
  if(!state||!root.current||typeof IntersectionObserver==='undefined')return;
  displayed.current??=new Map((items??[]).map(n=>[n.id,n.revision]));
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){
   if(!entry.isIntersecting||document.visibilityState!=='visible')continue;
   const n=items?.find(n=>n.id===(entry.target as HTMLElement).dataset.notificationId);
   if(!n||n.read_at||displayed.current?.get(n.id)!==n.revision)continue;
   const key=`${n.id}:${n.revision}`;if(read.current.has(key))continue;read.current.add(key);void load({read:n.id,revision:n.revision});
  }},{threshold:0.9});
  root.current.querySelectorAll('[data-notification-id]').forEach(e=>observer.observe(e));return()=>observer.disconnect();
 },[state,compact]);
 return <section ref={root} aria-label="Notification list" className="font-sans">
  {(error||actionError)&&<p role="alert" className="p-3 text-sm text-danger">{actionError||error} <button onClick={()=>void load()}>Retry</button></p>}
  {!state&&!error&&<p role="status" className="p-4 text-sm text-muted">Loading notifications…</p>}
  {state&&!items?.length&&<div className="px-6 py-10 text-center"><Bell size={24} className="mx-auto mb-3 text-muted"/><p className="text-sm font-medium">You’re all caught up.</p><p className="mt-1 text-xs leading-5 text-muted">Invitations, replies and activity will appear here.</p></div>}
  <ul className="m-0 list-none divide-y divide-edge p-0">{items?.map(n=><NotificationRow key={n.id} item={n} busy={busy} onRead={()=>{void load({read:n.id,revision:n.revision});close?.();}} onRespond={action=>void respond(n,action)} onBlock={()=>void load({block:n.sender_id})}/>)}</ul>
  {!compact&&state?.next!=null&&<div className="border-t border-edge p-3 text-center"><Button onClick={()=>void loadMore()}>Load more</Button></div>}
 </section>;
}
