/**
 * CONNECT AS THE VIEWER (contracts ./viewer-connections). A page function's name declared `'viewer'` is bound, by the
 * page's author and server-side, to `{service, params}` (`ViewerBinding`, stored sealed with the page's other
 * connection values; no credential in it). Two decisions live here:
 *
 * - `validateViewerBinding`: may this AUTHOR bind those params at that service? Only the service can say, so it is
 *   asked: a viewer token for the author (identity `issueViewerToken`) and one session request with the params,
 *   whose credential is discarded. Run when the binding is set and again when a page carrying it is published.
 * - `viewerConnection`: the endpoint and short-lived credential a RUN connects with, from the same request made with a
 *   viewer token for the run's admitted caller (the signed `RunnerCaller` subject: never the page owner, never a
 *   value resolver code supplies). The service refusing this viewer, or no viewer at all (anonymous, a scheduled
 *   run), is `data_access_denied`; there is no fallback to anyone else's access and no direct connection. Anything
 *   else (no such service configured, identity or the service unavailable, a malformed answer) is `data_unavailable`.
 */
import {isResolverDatabaseKind,type DataService,type ViewerBinding} from '@artifactbin/contracts';
import {databaseConnection,type DatabaseConnection} from '@/lib/html-backend-secrets';
import {dataServices,services} from '@/lib/platform';
import {requestSession,SessionRefusal} from './sessions';

const serviceNamed=(id:string):DataService|undefined=>dataServices().find(service=>service.id===id);

/** Why an author may not bind: `data_service_not_configured`, `binding_forbidden`, `binding_rejected`, `data_service_unavailable`. */
export type ViewerBindingCode='data_service_not_configured'|'binding_forbidden'|'binding_rejected'|'data_service_unavailable';
export class ViewerBindingError extends Error {constructor(readonly code:ViewerBindingCode){super(code);this.name='ViewerBindingError';}}
/** The HTTP status a route answers each refusal with. */
export const VIEWER_BINDING_STATUS:Readonly<Record<ViewerBindingCode,number>>={data_service_not_configured:400,binding_forbidden:403,binding_rejected:422,data_service_unavailable:503};

/** A session for `userId` with the binding's params, or the refusal's HTTP status (0: no answer; -1: no token). */
async function sessionFor(service:DataService,userId:string,binding:ViewerBinding,actor:{artifactId:string;function?:string|null},signal?:AbortSignal){
 let token:string;
 try{token=(await services().identity.issueViewerToken({userId,service:service.audience,artifactId:actor.artifactId,function:actor.function??null})).token;}
 catch{throw new SessionRefusal(-1);}
 return requestSession(service,token,binding.params,signal?{signal}:{});
}

export async function validateViewerBinding(authorId:string,binding:ViewerBinding,pageId:string):Promise<void>{
 const service=serviceNamed(binding.service);
 if(!service)throw new ViewerBindingError('data_service_not_configured');
 try{await sessionFor(service,authorId,binding,{artifactId:pageId});}
 catch(error){
  const status=error instanceof SessionRefusal?error.status:0;
  throw new ViewerBindingError(status===401||status===403?'binding_forbidden':status>=400&&status<500?'binding_rejected':'data_service_unavailable');
 }
}

/** A run's refusal: `data_access_denied` or `data_unavailable`, with nothing else in it. */
export class ViewerRefusal extends Error {constructor(readonly code:'data_access_denied'|'data_unavailable'){super(code);this.name='ViewerRefusal';}}
export async function viewerConnection(input:{subject:string|null;binding:ViewerBinding;pageId:string;function?:string|null;signal?:AbortSignal}):Promise<DatabaseConnection>{
 if(!input.subject)throw new ViewerRefusal('data_access_denied');
 const service=serviceNamed(input.binding.service);
 if(!service)throw new ViewerRefusal('data_unavailable');
 let session;
 try{session=await sessionFor(service,input.subject,input.binding,{artifactId:input.pageId,function:input.function??null},input.signal);}
 catch(error){throw new ViewerRefusal(error instanceof SessionRefusal&&(error.status===401||error.status===403)?'data_access_denied':'data_unavailable');}
 if(!isResolverDatabaseKind(session.protocol))throw new ViewerRefusal('data_unavailable');
 // The session names its TLS mode: `disable` only for a service running plaintext. The runner's tunnel then decides
 // whether it may reach that endpoint, by the rule every resolver database meets: a public address over TLS, and
 // loopback or plaintext only under its own development opt-in (RUNNER__DATABASE_LOOPBACK).
 try{return databaseConnection({kind:session.protocol,host:session.host,port:session.port,database:session.database,user:session.user,password:session.password,tls:session.tls});}
 catch{throw new ViewerRefusal('data_unavailable');}
}
