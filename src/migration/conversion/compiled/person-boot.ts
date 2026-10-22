import type { CompiledPersonBinding } from "./person-contracts.ts";
import { validCompiledPersonBindings } from "./person-binding.ts";
export function personBootSource(
  bindings: readonly CompiledPersonBinding[],
): string {
  if (!validCompiledPersonBindings(bindings))
    throw Error("Invalid person bindings");
  return `const [people,setPeople]=createSignal({});
 const personDocument=gql\`query SelectedPerson($valueName:String!,$userId:String!){legacyData{person(valueName:$valueName,userId:$userId){name handle image}}}\`;
 const peopleAdapter=createCompiledPeople(${JSON.stringify(bindings)},{watch:(binding,userId,next,error)=>{const subscription=client.watchQuery({query:personDocument,variables:{valueName:binding.valueName,userId}}).subscribe(result=>{if(result.errors?.length)error();else if(result.data?.legacyData&&Object.hasOwn(result.data.legacyData,'person'))next(result.data.legacyData.person);});return()=>subscription.unsubscribe();},changed:setPeople});
 window.addEventListener('pagehide',event=>{if(!event.persisted)peopleAdapter.dispose();});`;
}
