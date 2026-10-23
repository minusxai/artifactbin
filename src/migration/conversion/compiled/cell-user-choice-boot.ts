import type { CompiledCellUserChoiceBinding } from "./cell-user-choice-contracts.ts";
export function cellUserChoiceBoot(
  bindings: readonly CompiledCellUserChoiceBinding[],
): string {
  const documents = Object.fromEntries(
    [...new Set(bindings.map((b) => b.backendNamespace))].map((name) => [
      name,
      `query CellUserChoices($name:String!,$column:String!){${name}{userChoices(name:$name,column:$column)}}`,
    ]),
  );
  return `const [cellUserOptions,setCellUserOptions]=createSignal({});
 const cellChoiceDocuments=Object.fromEntries(Object.entries(${JSON.stringify(documents)}).map(([name,source])=>[name,gql(Object.assign([source],{raw:[source]}))]));
 const cellChoiceAdapter=createCompiledCellUserChoices(${JSON.stringify(bindings)},{watch:(binding,next,error)=>{const subscription=client.watchQuery({query:cellChoiceDocuments[binding.backendNamespace],variables:{name:binding.queryName,column:binding.column},clearOnRefresh:true}).subscribe(result=>{if(result.errors?.length)error();else next(result.data?.[binding.backendNamespace]?.userChoices);});return()=>subscription.unsubscribe();},changed:setCellUserOptions});
 window.addEventListener('pagehide',event=>{if(!event.persisted)cellChoiceAdapter.dispose();});`;
}
