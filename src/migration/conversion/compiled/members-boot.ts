import { validCompiledMembersBinding } from "./members-binding.ts";
import type { CompiledMembersBinding } from "./members-contracts.ts";
export function membersBootSource(binding: CompiledMembersBinding): string {
  if (!validCompiledMembersBinding(binding))
    throw Error("Invalid members binding");
  return `let membersAdapter;
 const membersDocument=gql\`query PageMembers{${binding.backendNamespace}{members{generation rows}}}\`;
 membersAdapter=createCompiledMembers({read:async()=>{const result=await client.query({query:membersDocument});if(result.errors?.length||!result.data?.${binding.backendNamespace}?.members)throw Error('Page members unavailable');return result.data.${binding.backendNamespace}.members;},watch:notify=>{const subscription=client.watchQuery({query:membersDocument}).subscribe(result=>{if(result.errors?.length)notify(null);else if(result.data?.${binding.backendNamespace}?.members)notify(result.data.${binding.backendNamespace}.members);});return()=>subscription.unsubscribe();},changed:()=>{queryController.invalidate();setPending(true);queueMicrotask(()=>{if(membersAdapter)void run();});}});
 const refreshMembers=document.createElement('button');refreshMembers.type='button';refreshMembers.textContent='Refresh page members';refreshMembers.addEventListener('click',()=>{void membersAdapter.refresh().catch(()=>setControlError('Page members are unavailable. Check access and refresh.'));});controlStatus.after(refreshMembers);
 window.addEventListener('pagehide',event=>{if(!event.persisted){queryController.dispose();membersAdapter.dispose();}});`;
}
