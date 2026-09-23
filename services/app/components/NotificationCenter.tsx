import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,X,Settings,List} from 'lucide-react';
import {useSession} from '@/web/session';
import {PagePanel} from './PagePanel';
import {announcePanel,requestPageChrome,subscribePageChrome,useExclusiveLayer,useOpenOnRequest} from './page-chrome-state';
import {Tooltip} from './Tooltip';
import {useDialogKeyboard} from './use-dialog-keyboard';
import {NotificationContext, useNotifications, type InboxState} from './notification-context';
import {PeopleInbox} from './PeopleInbox';
export function NotificationProvider({children}:{children:ReactNode}){
 const {session}=useSession();const user=session?.kind==='account'?session.user?.id:null;
 const [state,setState]=useState<InboxState|null>(null),[error,setError]=useState('');
 const limit=useRef(50);
 const generation=useRef(0);const currentUser=useRef(user);currentUser.current=user;
 const load=useCallback(async(input?:object)=>{
  if(!user)return;const own=user;const seq=++generation.current;
  try{const r=await fetch('/api/my/people',input?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);if(!r.ok)throw Error('Could not load notifications');const result:InboxState=await r.json();
   while(result.next!==null&&result.next!==undefined&&result.notifications.length<limit.current){
    const page=await fetch(`/api/my/people?offset=${result.next}`);if(!page.ok)throw Error('Could not load notifications');
    const next:InboxState=await page.json();result.notifications.push(...next.notifications);result.next=next.next;
   }
   if(seq===generation.current&&currentUser.current===own){setState(result);setError('');}}
  catch{if(seq===generation.current&&currentUser.current===own)setError('Could not load notifications. Try again.');}
 },[user]);
 useEffect(()=>{limit.current=50;setState(null);setError('');if(!user)return;void load();
  const source=new EventSource('/api/my/people/events');source.onmessage=()=>void load();source.onerror=()=>setError('Connection interrupted. Retrying…');
  const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{source.close();generation.current++;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[user,load]);
 return <NotificationContext.Provider value={{state,error,load,loadMore:async()=>{limit.current+=50;await load();}}}>{children}</NotificationContext.Provider>;
}
/** Lives beside settings/profile inside the same trusted navigation boundary. */
export function NotificationMenu(){
 const value=useNotifications();const {session}=useSession();
 const [open,setOpen]=useState(false);
 useExclusiveLayer(open,setOpen);
 useOpenOnRequest('notifications',open,setOpen);
 useEffect(()=>{announcePanel('notifications',open);return()=>announcePanel('notifications',false);},[open]);
 useEffect(()=>{if(session?.kind!=='account')setOpen(false);},[session?.kind]);
 const close=useCallback(()=>setOpen(false),[]);
 if(!value||session?.kind!=='account')return null;
 return <PagePanel open={open} label="Notifications" onClose={close} header={null} wide><NotificationContext.Provider value={{...value,close}}><NotificationPanel onClose={close}/></NotificationContext.Provider></PagePanel>;
}
function NotificationPanel({onClose}:{onClose:()=>void}){
 const panel=useRef<HTMLDivElement>(null);
 useDialogKeyboard(panel,onClose,'button:not([disabled]),a[href],input:not([disabled]),summary');
 useEffect(()=>{let previous=document.activeElement as HTMLElement|null;while(previous?.shadowRoot?.activeElement)previous=previous.shadowRoot.activeElement as HTMLElement;panel.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
 return <div ref={panel} className="font-sans"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Notifications</h2><button aria-label="Close notifications" onClick={onClose} className="rounded-md p-2 hover:bg-raised"><X size={18}/></button></div><div className="max-h-[55vh] overflow-y-auto"><PeopleInbox compact/></div><nav aria-label="Notification links" className="mt-2 flex items-center justify-between gap-3 border-t border-edge pt-3"><a onClick={onClose} href="/notifications" className="inline-flex items-center gap-1.5 text-xs font-medium text-fg hover:text-accent"><List size={14}/>All notifications</a><a onClick={onClose} href="/account#notifications" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg"><Settings size={14}/>Notification settings</a></nav></div>;
}
export function NotificationBell(){
 const value=useNotifications();const {session}=useSession();const [open,setOpen]=useState(false);useEffect(()=>subscribePageChrome((which,opened)=>{if(which==='notifications')setOpen(opened);}),[]);if(!value||session?.kind!=='account')return null;
 return <Tooltip content="Notifications"><button type="button" aria-label={value.state?.unread?'Notifications, unread updates':'Notifications'} aria-expanded={open} onClick={()=>requestPageChrome('notifications')} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"><Bell size={20} strokeWidth={1.5}/>{!!value.state?.unread&&<span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500"/>}</button></Tooltip>;
}
