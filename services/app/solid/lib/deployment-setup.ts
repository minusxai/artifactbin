import { retryingFetch } from '@/lib/http/retry-lazily';
import {createSignal,onCleanup,onMount} from 'solid-js';
import type {DeploymentState} from '@artifactbin/contracts';
/** Public tokenless deployment metadata addresses setup without borrowing a recipient identity. Unmounting stops the read and its retries. */
export function useSetupDeployment(){
 const [state,setState]=createSignal<DeploymentState>();
 onMount(()=>{const controller=new AbortController();onCleanup(()=>controller.abort());void retryingFetch('/api/deployment',{signal:controller.signal}).then(async response=>{
  if(!response.ok)return;const value=await response.json() as DeploymentState;
  if(value.mode==='company'||value.mode==='public')setState(value);
 }).catch(()=>{});});
 return state;
}
