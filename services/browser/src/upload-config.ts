import {createEnv} from '@artifactbin/utils';
import type {UploadOptions} from './upload';
/** Audited environment boundary for browser upload transport. */
export function browserUploadOptions(environment:NodeJS.ProcessEnv):UploadOptions|undefined {
  const {env}=createEnv(environment),origin=env('BROWSER','UPLOAD_ORIGIN');
  if(!origin)return undefined;
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||url.protocol!=='https:')throw new Error('BROWSER__UPLOAD_ORIGIN must be an HTTPS origin');
  const prefix=env('BROWSER','UPLOAD_PREFIX');
  if(!prefix?.startsWith('/')||!prefix.endsWith('/')||prefix.includes('..'))throw new Error('BROWSER__UPLOAD_PREFIX must be an absolute object prefix');
  const proxyUrl=env('BROWSER','UPLOAD_PROXY_URL');
  if(proxyUrl){const proxy=new URL(proxyUrl);if(proxy.origin!==proxyUrl||proxy.username||proxy.password||!['http:','https:'].includes(proxy.protocol))throw new Error('BROWSER__UPLOAD_PROXY_URL must be an HTTP origin');}
  return {origin,prefix,...(proxyUrl?{proxyUrl}:{})};
}
