import type { DatasetRole, HtmlPageVersion, PageNamespaceSource, PageOperations, PageResolverInvoker } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import type { PageDatasetPort } from './contracts';
import {composePageSchema,executePageOperation} from './namespaces';
export interface PageOperationPorts {
 readPage(actor:AccessActor,pageId:string,revision:string):Promise<HtmlPageVersion>;
 /** The caller's page role (lib/dataset-permissions `pageRole`), null when they cannot read the page; never reconstructed from request variables. */
 role(actor:AccessActor,pageId:string):Promise<DatasetRole|null>;
 sources(actor:AccessActor,page:HtmlPageVersion,signal?:AbortSignal):Promise<readonly PageNamespaceSource[]>;
 invoke:PageResolverInvoker['invoke'];
 /** The page's generated-API dataset links for this caller (the same load `sources` composed), when it has any. */
 datasets?(actor:AccessActor,page:HtmlPageVersion,signal?:AbortSignal):Promise<PageDatasetPort|undefined>;
 /** The built-in viewer's display name for a signed-in subject (contracts `PAGE_VIEWER_ROOT`), read only when selected. */
 viewerName?(subject:string):Promise<string|null>;
}
export function createPageOperations(ports:PageOperationPorts):PageOperations<AccessActor>{
 return {
 async schema(actor,pageId,revision){const page=await ports.readPage(actor,pageId,revision);if(!await ports.role(actor,pageId))throw Error('forbidden');return composePageSchema(await ports.sources(actor,page)).sdl;},
 async execute(actor,request,signal){
  const page=await ports.readPage(actor,request.pageId,request.revision);
  if(page.pageId!==request.pageId||page.revision!==request.revision)throw Error('page_revision_mismatch');
  const role=await ports.role(actor,page.pageId);
  if(!role)throw Error('forbidden');
  const schema=composePageSchema(await ports.sources(actor,page,signal));
  const datasets=await ports.datasets?.(actor,page,signal);
  return executePageOperation({schema,request,caller:{pageId:page.pageId,subject:actor.userId,role},signal,invoke:ports.invoke,...(datasets?{datasets}:{}),...(ports.viewerName?{viewerName:ports.viewerName}:{})});
 }
 };
}
