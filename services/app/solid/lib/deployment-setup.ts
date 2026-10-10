import {createSignal,onMount} from 'solid-js';
import type {DeploymentState} from '@artifactbin/contracts';
/** Public tokenless deployment metadata addresses setup without borrowing a recipient identity. */
export function useSetupDeployment(){
 const [state,setState]=createSignal<DeploymentState>();
 onMount(()=>{void fetch('/api/deployment').then(async response=>{
  if(!response.ok)return;const value=await response.json() as DeploymentState;
  if(value.mode==='company'||value.mode==='public')setState(value);
 }).catch(()=>{});});
 return state;
}
