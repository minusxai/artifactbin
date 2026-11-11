import type {HtmlDatasetLink,HtmlDefaultConnectionLink,HtmlPageLink} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
/** A clone carries authorized dataset references only; nothing of the source page's access crosses to the copy. */
export interface HtmlClonePlan {htmlDatasets:readonly (HtmlDatasetLink|HtmlDefaultConnectionLink)[]}
export interface HtmlClonePorts {
 authorizeDataset(actor:AccessActor,binding:HtmlDatasetLink):Promise<void>;
}
export async function planHtmlClone(actor:AccessActor,links:readonly HtmlPageLink[],ports:HtmlClonePorts):Promise<HtmlClonePlan>{
 const htmlDatasets:(HtmlDatasetLink|HtmlDefaultConnectionLink)[]=[];
 for(const link of links){
  // Only the link's own fields: a stored link may carry retired keys.
  if(link.kind==='dataset'){await ports.authorizeDataset(actor,link);htmlDatasets.push(link.mode==='pinned'?{kind:'dataset',name:link.name,datasetId:link.datasetId,mode:'pinned',revision:link.revision}:{kind:'dataset',name:link.name,datasetId:link.datasetId,mode:'live'});continue;}
  // The default connection carries no reference to authorize: the copy names it as the source did.
  if(link.kind==='default-connection')htmlDatasets.push({kind:'default-connection',name:link.name,namespace:link.namespace});
  // Any other stored link (a removed page function's) is not copied.
 }
 return {htmlDatasets};
}
