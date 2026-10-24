import {RemoteUnreachable,type RemotePort} from './apollo/apollo-contracts';
/** Preview routing configuration, not authorization. Server validates Host/Origin and the opaque session. */
export interface LocalDatasetTransportConfig {privatePreview:boolean;endpoint:string}
export function createLocalDatasetTransport(config:LocalDatasetTransportConfig,location:Pick<Location,'origin'|'protocol'|'hostname'>,send:typeof fetch):RemotePort{
 const allowed=config.privatePreview&&location.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&/^\/__af_preview\/datasets(?:\/[A-Za-z0-9_-]+)?$/.test(config.endpoint);
 return {online:()=>allowed,async execute(request){
 if(!allowed)throw new RemoteUnreachable('Local dataset preview is unavailable');
 const response=await send(new URL(config.endpoint,location.origin),{method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
 if(!response.ok)throw new Error('Local dataset operation failed');
 return await response.json() as Awaited<ReturnType<RemotePort['execute']>>;
 }};
}
