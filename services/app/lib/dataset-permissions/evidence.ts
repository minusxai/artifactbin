/** Purpose-only select context. Only the canonical evidence reader installs this server-owned scope;
 * it never changes the actor, generic artifact ACLs, write decisions or dataset API readership.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import type {AccessActor} from '@/lib/accounts';
interface EvidenceSelect {actor:AccessActor;pageId:string;groupId:string;datasetIds:readonly string[]}
const context=new AsyncLocalStorage<EvidenceSelect>();
export function withPageEvidenceSelect<T>(scope:EvidenceSelect,run:()=>Promise<T>):Promise<T>{return context.run(scope,run);}
export function pageEvidenceRole(actor:AccessActor,row:{id:string;group_id?:string|null},pageId?:string):'viewer'|null|undefined{
 const scope=context.getStore();
 if(!scope||actor!==scope.actor)return undefined;
 return pageId===scope.pageId&&row.group_id===scope.groupId&&scope.datasetIds.includes(row.id)?'viewer':null;
}
