import {hostedOperationTools} from '@/lib/operations/hosted-tools';
import {setHostedRemoteAgent} from '@/lib/remote/hosted-interface';
import {startLambdaSchedules,setLambdaProgramResolver,type LambdaProgramResolver} from '@/lib/runner';
import {setNotificationDelivery,type NotificationDelivery} from '@/lib/notifications';
export type {NotificationDelivery} from '@/lib/notifications';
import {startAppBackgroundTasks} from '@/lib/runtime';
import {startDomainRecheck} from '@/lib/serving';
import {startMermaidHarvester} from '@/lib/story/assets/mermaid-harvester';
import {setDocumentEditorPolicy,type DocumentEditorPolicy} from '@/lib/artifacts';
import {setMutationInvocation,type MutationInvocationFactory} from '@/lib/artifacts';
import {useSqlExtensions} from '@/lib/sql/extensions';
import type {Actor,Upstream,RunnerService,HostedRemoteAgent} from '@artifactbin/contracts';
import {externalHostedComments,clearExternalHostedComments} from '@/lib/remote/hosted-comments';
import {HOSTED_AGENT_SERVICE_URL,RUNNER_ACTOR_SECRET} from '@/lib/platform/config';
import {getDb,type Db} from '@/lib/platform';
import {inProcess,hostedAgentClient,hostedAgentDeliveryTransport,hostedAgentTransport} from '@artifactbin/utils';
import {setServices,services,type Services} from '@/lib/platform';
import {createAppServer,type AppServerOptions} from './app';
export interface AppHostOptions extends AppServerOptions {
 services?:Partial<Services>;
 lambdaPrograms?:LambdaProgramResolver;
 /** Deployment-owned implementation; no allocator, prompt or provider credentials belong to the app. */
 hostedAgent?:(context:{db:Db;runner:RunnerService;operationTools:ReturnType<typeof hostedOperationTools>})=>Promise<{agent:HostedRemoteAgent;tick:()=>Promise<void>;close?:()=>Promise<void>}>;
 notificationDelivery?:NotificationDelivery;
 documentEditorPolicy?:DocumentEditorPolicy;
 mutationInvocation?:MutationInvocationFactory;
 shutdown?:()=>Promise<void>;
 initialize?:(db:Db)=>Promise<void>;
 identity?:(upstream:Upstream)=>{fetch:(request:Request)=>Promise<Response>};
 /**
  * The composition's SQL extensions module: the SAME specifier its SQL pool receives
  * (`createSql(caps, { extensions })`), absolute (a file URL or a package name) so both
  * resolve one file. The app's own analysis of a <Mutation> installs it too (lib/sql/extensions).
  */
 sqlExtensions?:string;
}
export interface AppHost {
 fetch:(request:Request)=>Promise<Response>;
 close:()=>Promise<void>;
 request:(request:Request,actor:Actor)=>Promise<Response>;
}
/** Shared host composition; no local SQL/browser implementation or deployment identity is imported here. */
export async function createAppHost(options:AppHostOptions={}):Promise<AppHost>{
 setDocumentEditorPolicy(options.documentEditorPolicy);
 setNotificationDelivery(options.notificationDelivery);
 const db=await getDb();
 setMutationInvocation(options.mutationInvocation);
 await useSqlExtensions(options.sqlExtensions);
 if(options.services)setServices(options.services);
 await options.initialize?.(db);
 setLambdaProgramResolver(options.lambdaPrograms);
 const stopSchedules=await startLambdaSchedules(db);
 const hosted=await resolveHostedAgent({url:HOSTED_AGENT_SERVICE_URL,secret:RUNNER_ACTOR_SECRET,factory:options.hostedAgent},{db,runner:services().runner,operationTools:hostedOperationTools()});
 setHostedRemoteAgent(hosted?.agent);
 let ticking:Promise<void>|undefined;
 const timer=hosted?setInterval(()=>{if(!ticking)ticking=hosted.tick().catch(error=>console.error('[hosted-agent] dispatch failed',error instanceof Error?error.message:'unknown')).finally(()=>{ticking=undefined;});},1000):undefined;
 timer?.unref();
 const stopBackgroundTasks=await startAppBackgroundTasks(db);
 // Custom domains' daily TXT re-check: at boot, then every 24h, flag or no flag (lib/custom-domains).
 const stopRecheck=startDomainRecheck();
 // Published diagrams are drawn to stored SVG in the background (lib/mermaid-images); nothing waits on it.
 const stopHarvester=startMermaidHarvester();
 const app=createAppServer(options),request=inProcess(app);
 const fetch=options.identity?.(request).fetch??((incoming:Request)=>Promise.resolve(app.fetch(incoming)));
 let closing:Promise<void>|undefined;
 return {fetch,request,close:()=>closing??=(async()=>{
  try{clearInterval(timer);await ticking;await hosted?.close?.();setHostedRemoteAgent(undefined);clearExternalHostedComments();setLambdaProgramResolver(undefined);await stopSchedules();await stopBackgroundTasks();await stopRecheck();await stopHarvester();await services().events.close?.();await options.shutdown?.();}
  finally{await db.close();}
 })()};
}
/** Explicit URL wins over a deployment factory. Missing authentication never falls back locally. */
export function externalHostedAgent(url:string,secret:string|undefined):Awaited<ReturnType<NonNullable<AppHostOptions['hostedAgent']>>>{
 if(!secret)throw Error('CONTRACT__ACTOR_SECRET required for remote hosted agent');
 const agent=hostedAgentClient(url,hostedAgentTransport(url,secret),hostedAgentDeliveryTransport(url,secret));
 return {agent,tick:externalHostedComments(agent,secret)};
}
export async function resolveHostedAgent(options:{url?:string;secret?:string;factory?:AppHostOptions['hostedAgent']},context:Parameters<NonNullable<AppHostOptions['hostedAgent']>>[0]){
 return options.url?externalHostedAgent(options.url,options.secret):options.factory?.(context);
}
