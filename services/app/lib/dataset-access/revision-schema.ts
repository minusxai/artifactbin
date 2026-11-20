/** A page revision's schema uses the SQL reader's canonical mounts, with deferred row IDs: no row objects opened. */
import type {ColumnType} from '@artifactbin/contracts/sql';
import type {HtmlDatasetLink} from '@artifactbin/contracts/html-page';
import type {AccessActor} from '@/lib/accounts';
import {loadLinked} from './linked';
import {pageSqlMounts} from './page-sql';
export async function pageRevisionSchema(actor:AccessActor,links:readonly HtmlDatasetLink[],pageId:string,retainReadFence:(verify:()=>Promise<void>)=>void,signal:AbortSignal){
 const loaded=await loadLinked(actor,links,{pageId,fenced:true,deferRowIds:true,retainReadFence},signal);
 if(loaded.length!==links.length)throw Error('dataset_not_found');
 const tables:{schema:string;name:string;columns:{name:string;type:ColumnType}[]}[]=pageSqlMounts(loaded.map(l=>({link:l.link!.name,snapshot:l.snapshot,tables:l.tables.map(t=>({tableId:t.tableId,selectable:t.model.select!==false}))})),new Set(links.map(l=>l.name)),false).map(m=>({schema:m.schema,name:m.name,columns:m.columns.map(c=>({name:c.name,type:c.type}))}));
 return {tables,identity:loaded.map(l=>[l.datasetId,l.snapshot?.policyIdentity])};
}
