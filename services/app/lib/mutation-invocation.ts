import type {MutationInput,MutationOutcome,SqlService} from '@artifactbin/contracts';
import type {ArtifactRow,RoleActor} from './artifacts';
import type {Db} from './db';
import type {MutationDocument} from './datasets/policy';
export interface MutationContext {
 dataset:ArtifactRow;
 actor:RoleActor;
 document?:MutationDocument;
 db:Db;
 recheckAccess:()=>Promise<void>;
}
export interface MutationInvocation {
 run:(input:MutationInput,engine:Pick<SqlService,'mutate'>)=>Promise<MutationOutcome>;
}
/** One invocation spans storage retries. Downstream adapters own any external effects. */
export type MutationInvocationFactory=(context:MutationContext)=>MutationInvocation;
let factory:MutationInvocationFactory|undefined;
export function setMutationInvocation(next:MutationInvocationFactory|undefined):void{factory=next;}
export function mutationInvocation(context:MutationContext):MutationInvocation{
 return factory?.(context)??{run:(input,engine)=>engine.mutate(input)};
}
