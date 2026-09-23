import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,X} from 'lucide-react';
import {useSession} from '@/web/session';
import MobileSheet,{useIsPhoneViewport} from './MobileSheet';
import {Tooltip} from './Tooltip';
import {useDialogKeyboard} from './use-dialog-keyboard';
import {NotificationContext, useNotifications, type InboxState} from './notification-context';
import {PeopleInbox} from './PeopleInbox';
export function NotificationProvider({children}:{children:ReactNode}){
 const {session}=useSession();const user=session?.kind==='account'?session.user?.id:null;
 const [state,setState]=useState<InboxState|null>(null),[error,setError]=useState(''),[opened,setOpened]=useState(false);
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
 useEffect(()=>{limit.current=50;setState(null);setOpened(false);setError('');if(!user)return;void load();
  const source=new EventSource('/api/my/people/events');source.onmessage=()=>void load();source.onerror=()=>setError('Connection interrupted. Retrying…');
  const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{source.close();generation.current++;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[user,load]);
 const phone=useIsPhoneViewport();
 const close=useCallback(()=>setOpened(false),[]);
 const content=<NotificationPanel onClose={close}/>;
 return <NotificationContext.Provider value={{state,error,load,close,loadMore:async()=>{limit.current+=50;await load();},open:()=>setOpened(true)}}>{children}{opened&&user&&(phone?<MobileSheet label="Notifications" onClose={close}>{content}</MobileSheet>:<><button aria-label="Close notifications by clicking outside" className="fixed inset-0 z-[70] bg-black/10" onClick={()=>setOpened(false)}/><aside role="dialog" aria-modal="true" aria-label="Notifications" className="fixed right-3 top-14 z-[80] max-h-[80vh] w-96 max-w-[calc(100vw-24px)] overflow-auto rounded-xl border border-edge bg-surface p-4 shadow-xl">{content}</aside></>)}</NotificationContext.Provider>;
}
function NotificationPanel({onClose}:{onClose:()=>void}){
 const panel=useRef<HTMLDivElement>(null);
 useDialogKeyboard(panel,onClose,'button:not([disabled]),a[href],input:not([disabled]),summary');
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;panel.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
 return <div ref={panel}><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Notifications</h2><button aria-label="Close notifications" onClick={onClose} className="rounded-md p-2 hover:bg-raised"><X size={18}/></button></div><PeopleInbox compact/><a onClick={onClose} href="/account#notifications" className="mt-3 block text-xs text-muted hover:text-fg">Notification settings →</a></div>;
}
export function NotificationBell(){
 const value=useNotifications();const {session}=useSession();if(!value||session?.kind!=='account')return null;
 return <Tooltip content="Notifications"><button type="button" aria-label={value.state?.unread?'Notifications, unread updates':'Notifications'} onClick={value.open} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"><Bell size={20} strokeWidth={1.5}/>{!!value.state?.unread&&<span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500"/>}</button></Tooltip>;
}
