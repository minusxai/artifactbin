import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,X} from 'lucide-react';
import {useSession} from '@/web/session';
import MobileSheet,{useIsPhoneViewport} from './MobileSheet';
import {Tooltip} from './Tooltip';
import {PeopleInbox} from './PeopleInbox';
export interface InboxItem {id:string;artifact_id:string|null;user_id:string;status:string|null;direction:string|null;sender_id:string;username:string|null;kind:string;source:string|null;title:string|null;read_at:string|null;revision:number}
export interface InboxState {autoAccept:boolean;notifications:InboxItem[];blocks:Array<{user_id:string;username:string|null}>;unread:number;next:number|null}
const Context=createContext<{state:InboxState|null;error:string;load:(input?:object)=>Promise<void>;open:()=>void}|null>(null);
export const useNotifications=()=>useContext(Context);
export function NotificationProvider({children}:{children:ReactNode}){
 const {session}=useSession();const user=session?.kind==='account'?session.user?.id:null;
 const [state,setState]=useState<InboxState|null>(null),[error,setError]=useState(''),[opened,setOpened]=useState(false);
 const generation=useRef(0);const currentUser=useRef(user);currentUser.current=user;
 const load=useCallback(async(input?:object)=>{
  if(!user)return;const own=user;const seq=++generation.current;
  try{const r=await fetch('/api/my/people',input?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);if(!r.ok)throw Error('Could not load notifications');const result=await r.json();if(seq===generation.current&&currentUser.current===own){setState(result);setError('');}}
  catch{if(currentUser.current===own)setError('Could not load notifications. Try again.');}
 },[user]);
 useEffect(()=>{setState(null);setOpened(false);setError('');if(!user)return;void load();
  const source=new EventSource('/api/my/people/events');source.onmessage=()=>void load();source.onerror=()=>setError('Connection interrupted. Retrying…');
  const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{source.close();generation.current++;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[user,load]);
 useEffect(()=>{if(!opened)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpened(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[opened]);
 const phone=useIsPhoneViewport();
 const content=<PeopleInbox compact/>;
 return <Context.Provider value={{state,error,load,open:()=>setOpened(true)}}>{children}{opened&&user&&(phone?<MobileSheet label="Notifications" onClose={()=>setOpened(false)} header={<h2>Notifications</h2>}>{content}</MobileSheet>:<><button aria-label="Close notifications by clicking outside" className="fixed inset-0 z-[70] bg-black/10" onClick={()=>setOpened(false)}/><aside role="dialog" aria-label="Notifications" className="fixed right-3 top-14 z-[80] max-h-[80vh] w-96 max-w-[calc(100vw-24px)] overflow-auto rounded-xl border border-edge bg-surface p-4 shadow-xl"><div className="flex items-center justify-between"><h2 className="font-semibold">Notifications</h2><button aria-label="Close notifications" onClick={()=>setOpened(false)}><X size={18}/></button></div>{content}</aside></>)}</Context.Provider>;
}
export function NotificationBell(){
 const value=useNotifications();const {session}=useSession();if(!value||session?.kind!=='account')return null;
 return <Tooltip content="Notifications"><button type="button" aria-label={value.state?.unread?'Notifications, unread updates':'Notifications'} onClick={value.open} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"><Bell size={20} strokeWidth={1.5}/>{!!value.state?.unread&&<span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500"/>}</button></Tooltip>;
}
