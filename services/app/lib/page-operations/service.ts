import type { ArtifactRole, HtmlPageVersion, PageNamespaceSource, PageOperations, PageResolverInvoker } from '@artifactbin/contracts';
import { pageResolverRole } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import {composePageSchema,executePageOperation} from './namespaces';
export interface PageOperationPorts {
 readPage(actor:AccessActor,pageId:string,revision:string):Promise<HtmlPageVersion>;
 /** Original Artifactbin effectiveRole; never reconstructed from request variables. */
 role(actor:AccessActor,pageId:string):Promise<ArtifactRole>;
 sources(actor:AccessActor,page:HtmlPageVersion,signal?:AbortSignal):Promise<readonly PageNamespaceSource[]>;
 invoke:PageResolverInvoker['invoke'];
}
export function createPageOperations(ports:PageOperationPorts):PageOperations<AccessActor>{
 return {
 async schema(actor,pageId,revision){const page=await ports.readPage(actor,pageId,revision);if(!pageResolverRole(await ports.role(actor,pageId)))throw Error('forbidden');return composePageSchema(await ports.sources(actor,page)).sdl;},
 async execute(actor,request,signal){
  const page=await ports.readPage(actor,request.pageId,request.revision);
  if(page.pageId!==request.pageId||page.revision!==request.revision)throw Error('page_revision_mismatch');
  const role=pageResolverRole(await ports.role(actor,page.pageId));
  if(!role)throw Error('forbidden');
  const schema=composePageSchema(await ports.sources(actor,page,signal));
  return executePageOperation({schema,request,caller:{pageId:page.pageId,subject:actor.userId,role},signal,invoke:ports.invoke});
 }
 };
}
