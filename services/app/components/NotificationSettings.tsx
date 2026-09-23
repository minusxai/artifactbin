import {useEffect,useState} from 'react';
import {Button} from './ui';
import {useNotificationInbox} from './use-notification-inbox';
type EmailPreferences={invitations:boolean;comments:boolean;activity:boolean};

export function NotificationSettings(){
 const {state,error,load}=useNotificationInbox();
 const [email,setEmail]=useState<EmailPreferences|null>(null),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{void fetch('/api/my/people/email').then(r=>r.ok?r.json():null).then(data=>{if(data?.enabled)setEmail(data.preferences);}).catch(()=>{});},[]);
 const saveEmail=async(preferences:EmailPreferences)=>{
  setSaving(true);setNotice('');
  try{const r=await fetch('/api/my/people/email',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(preferences)});if(!r.ok)throw Error();setEmail((await r.json()).preferences);setNotice('Saved');}catch{setNotice('Could not save email preferences. Try again.');}finally{setSaving(false);}
 };
 return <section id="notifications" aria-label="Notification settings" className="rounded-lg border border-edge bg-surface p-5 font-sans">
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Notification settings</h2><a href="/notifications" className="text-sm text-muted hover:text-fg">All notifications</a></div>
  <p className="mt-1 text-sm text-muted">Choose how invitations and updates reach you.</p>
  {error&&<p role="alert" className="mt-3 text-sm text-danger">{error} <button onClick={()=>void load()}>Retry</button></p>}
  {state&&<div className="mt-5 border-t border-edge pt-4"><h3 className="mb-3 text-sm font-medium">Invitations</h3><label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-accent" checked={state.autoAccept} onChange={e=>void load({autoAccept:e.target.checked})}/><span>Automatically accept invitations from people I follow.<span className="mt-1 block text-xs leading-5 text-muted">You can review invitations from everyone else before joining.</span></span></label></div>}
  {email&&<fieldset disabled={saving} className="mt-5 space-y-3 border-t border-edge pt-4"><legend className="text-sm font-medium">Email notifications</legend>{(['invitations','comments','activity'] as const).map(key=><label key={key} className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-accent" checked={email[key]} onChange={e=>void saveEmail({...email,[key]:e.target.checked})}/><span>{key==='invitations'?'Invitations':key==='comments'?'Unread comment updates':'Likes and follows'}<span className="mt-1 block text-xs text-muted">{key==='invitations'?'As soon as you’re invited.':key==='comments'?'Only if you haven’t read the update after a few minutes.':'One daily summary.'}</span></span></label>)}</fieldset>}
  {notice&&<p role="status" className="mt-3 text-xs text-muted">{notice}</p>}
  {!!state?.blocks.length&&<div className="mt-5 border-t border-edge pt-4"><h3 className="mb-2 text-sm font-medium">Blocked people</h3>{state.blocks.map(b=><div className="flex items-center justify-between py-2" key={b.user_id}><span className="text-sm">@{b.username??b.user_id}</span><Button variant="ghost" onClick={()=>void load({unblock:b.user_id})}>Unblock</Button></div>)}</div>}
 </section>;
}
