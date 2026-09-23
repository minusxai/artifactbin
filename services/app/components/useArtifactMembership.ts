import {useCallback,useEffect,useRef,useState} from 'react';
import type {MembershipState} from '@artifactbin/contracts';

/** The server owns membership; chrome only presents its acknowledged state. */
export function useArtifactMembership(artifactId:string,enabled:boolean,revision:number,onChange:()=>void){
 const [state,setState]=useState<MembershipState|null>(null),[error,setError]=useState('');
 const busy=useRef(false);
 const endpoint=`/api/my/artifacts/${encodeURIComponent(artifactId)}/members`;
 const read=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch(endpoint,{signal});
  const result=await response.json();
  if(!response.ok||!Array.isArray(result.members)||!Array.isArray(result.pending))throw Error(result.detail??'Could not load people');
  return result as MembershipState;
 },[endpoint]);
 useEffect(()=>{setState(null);setError('');},[enabled,endpoint]);
 useEffect(()=>{
  if(!enabled)return;
  const abort=new AbortController();
  const refresh=()=>{void read(abort.signal).then(setState).catch(()=>{});};
  refresh();window.addEventListener('focus',refresh);
  return()=>{abort.abort();window.removeEventListener('focus',refresh);};
 },[enabled,read,revision]);
 const join=useCallback(async()=>{
  if(busy.current)return;
  busy.current=true;setError('');
  try{
   const current=await read();
   const action=current.self?.status==='pending'&&current.self.direction==='invitation'?'accept':'join';
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
   const result=await response.json();
   if(!response.ok||!Array.isArray(result.members)||!Array.isArray(result.pending))throw Error(result.detail??'Could not join artefact');
   setState(result);onChange();
  }catch(e){setError(e instanceof Error?e.message:'Could not join artefact');}
  finally{busy.current=false;}
 },[endpoint,onChange,read]);
 return {status:state?.self?.status==='accepted'?'joined' as const:state?.self?.status==='pending'?'pending' as const:'join' as const,join,error};
}
