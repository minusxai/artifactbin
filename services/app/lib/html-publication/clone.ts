import type {HtmlDatasetLink,HtmlPageLink} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import type {PreparedHtmlBackend,HtmlBackendVersionRecord} from '@/lib/html-backends';
/** A clone contains code and authorized references only; runtime stores and credentials never cross pages. */
export interface HtmlClonePlan {htmlBackends:readonly PreparedHtmlBackend[];htmlDatasets:readonly HtmlDatasetLink[]}
export interface HtmlClonePorts {
 backend(id:string,version:string):Promise<HtmlBackendVersionRecord|null>;
 authorizeDataset(actor:AccessActor,binding:HtmlDatasetLink):Promise<void>;
}
export async function planHtmlClone(actor:AccessActor,pageId:string,links:readonly HtmlPageLink[],ports:HtmlClonePorts):Promise<HtmlClonePlan>{
 const htmlBackends:PreparedHtmlBackend[]=[];const htmlDatasets:HtmlDatasetLink[]=[];
 for(const link of links){
  if(link.kind==='dataset'){await ports.authorizeDataset(actor,link);htmlDatasets.push({...link});continue;}
  const backend=await ports.backend(link.backendId,link.version);
  if(!backend||backend.pageId!==pageId||backend.name!==link.name)throw Error('backend_link_mismatch');
  // Declaration names are immutable code metadata; secret rows are scoped to the fresh backend ID.
  // Never spread owner authority, credential values, or store state.
  htmlBackends.push({name:link.name,source:backend.source,typeDefs:backend.typeDefs,compiled:backend.compiled,...(backend.secretBindings?{secretBindings:[...backend.secretBindings]}:{})});
 }
 return {htmlBackends,htmlDatasets};
}
