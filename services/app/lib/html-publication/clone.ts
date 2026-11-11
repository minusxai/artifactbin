import type {HtmlDatasetLink,HtmlDefaultConnectionLink,HtmlLiveDatasetLink,HtmlPageLink} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
/** A clone carries authorized dataset references only; nothing of the source page's access crosses to the copy. */
export interface HtmlClonePlan {htmlDatasets:readonly (HtmlDatasetLink|HtmlDefaultConnectionLink|HtmlLiveDatasetLink)[]}
export interface HtmlClonePorts {
 authorizeDataset(actor:AccessActor,binding:HtmlDatasetLink):Promise<void>;
}
export async function planHtmlClone(actor:AccessActor,links:readonly HtmlPageLink[],ports:HtmlClonePorts):Promise<HtmlClonePlan>{
 const htmlDatasets:(HtmlDatasetLink|HtmlDefaultConnectionLink|HtmlLiveDatasetLink)[]=[];
 for(const link of links){
  // Only the link's own fields: a stored link may carry retired keys.
  if(link.kind==='dataset'){await ports.authorizeDataset(actor,link);htmlDatasets.push(link.mode==='pinned'?{kind:'dataset',name:link.name,datasetId:link.datasetId,mode:'pinned',revision:link.revision}:{kind:'dataset',name:link.name,datasetId:link.datasetId,mode:'live'});continue;}
  // The default connection carries no reference to authorize: the copy names it as the source did.
  if(link.kind==='default-connection'){htmlDatasets.push({kind:'default-connection',name:link.name,namespace:link.namespace});continue;}
  // A live dataset's link is a reference, as written; its declared queries are the fork door's to re-check (lib/live-datasets).
  if(link.kind==='live-dataset')htmlDatasets.push({kind:'live-dataset',name:link.name,datasetId:link.datasetId});
  // Any other stored link (a removed page function's) is not copied.
 }
 return {htmlDatasets};
}
