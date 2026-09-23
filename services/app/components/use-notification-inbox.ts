import {useCallback,useEffect,useState} from 'react';
import {useNotifications,type InboxState} from './notification-context';

/** Reuse the live provider; isolated mounts use the same inbox API. */
export function useNotificationInbox(){
 const shared=useNotifications();
 const [local,setLocal]=useState<InboxState|null>(null),[error,setError]=useState('');
 const load=useCallback(async(input?:object)=>{
  if(shared){await shared.load(input);return;}
  try{
   const response=await fetch('/api/my/people',input?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
   const data=await response.json();
   if(!response.ok||!Array.isArray(data.notifications)||!Array.isArray(data.blocks)||typeof data.autoAccept!=='boolean')throw Error('Could not load notifications');
   setLocal(data);setError('');
  }catch(e){setError(e instanceof Error?e.message:'Could not load notifications');}
 },[shared]);
 useEffect(()=>{if(!shared)void load();},[shared,load]);
 const loadMore=async()=>{
  if(shared?.loadMore){await shared.loadMore();return;}
  if(local?.next==null)return;
  try{const r=await fetch(`/api/my/people?offset=${local.next}`);if(!r.ok)throw Error();const next:InboxState=await r.json();setLocal({...next,notifications:[...local.notifications,...next.notifications]});}catch{setError('Could not load more notifications');}
 };
 return {state:shared?.state??local,error:shared?.error||error,load,loadMore,close:shared?.close};
}
