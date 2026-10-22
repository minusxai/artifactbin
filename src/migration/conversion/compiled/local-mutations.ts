import type{CompiledLocalMutationPorts}from'./local-mutation-contracts.ts';
/** Serial viewer-only writes; the port contains no network or backend authority. */
export function createCompiledLocalMutations(names:readonly string[],ports:CompiledLocalMutationPorts){
 let tail=Promise.resolve(),disposed=false,count=0;
 return {pending:()=>count>0,dispose(){disposed=true;ports.invalidate();},mutate(name:string,args?:unknown,row?:unknown){
  if(disposed||!names.includes(name))return Promise.reject(Error('Local mutation unavailable'));
  const copied=structuredClone({args,row});count++;ports.changed(true);
  const answer=tail.then(async()=>{if(disposed)throw Error('Local mutation cancelled');ports.invalidate();const snapshot=structuredClone(ports.read());const result=await ports.execute(name,copied.args,copied.row,snapshot);if(disposed)throw Error('Local mutation cancelled');ports.invalidate();ports.commit(snapshot,result);return true;});
  tail=answer.then(()=>{},()=>{});return answer.finally(()=>{count--;ports.changed(count>0);});
 }};
}
