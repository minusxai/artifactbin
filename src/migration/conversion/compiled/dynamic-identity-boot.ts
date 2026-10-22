import type { LocalDynamicIdentityPlan } from "./reactive-source-contracts.ts";
/** A failed identity invariant freezes controls and reports a permanent visible failure. */
export function dynamicIdentityBoot(plan: LocalDynamicIdentityPlan): string {
  return `let identityFailed=false,stopIsland,stopAuthored=()=>{},pageSubscription;
 const failIdentity=()=>{if(identityFailed)return;identityFailed=true;generation++;stopIsland?.();stopAuthored();pageSubscription?.unsubscribe();document.body.inert=true;const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent='This page could not preserve its document identities. Interactive controls have stopped.';document.documentElement.append(notice);};
 const identityController=installDynamicIdentities(document,${JSON.stringify(plan)},failIdentity);
 const flushIdentities=()=>{try{identityController.flush();}catch{identityController.dispose();failIdentity();}};
 window.addEventListener('pagehide',event=>{if(!event.persisted){identityController.dispose();stopIsland?.();stopAuthored();pageSubscription?.unsubscribe();}});`;
}
