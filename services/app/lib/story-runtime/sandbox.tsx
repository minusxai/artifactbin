import {useEffect,useRef} from 'react';
import {artifactApiScript,type ArtifactApiConfig} from '@/lib/story/script-api';
import {libraryUrls} from '@/lib/libraries';
import {AUTHOR_SCRIPT_BOOTSTRAP} from './author-script-bootstrap';
import {startAuthorScript} from './author-script';
import type {DataflowStore} from './store';
import {managedFrameLayout} from '@/lib/story/managed-frame-layout';

/** Author-owned HTML and code stay inside one visible opaque realm. The API
 * config and store are supplied by the document runtime, never by markup. */
export interface SandboxProps {
  html?: unknown; script?: unknown; title?: unknown; height?: unknown;
  id?: string; className?: string; 'data-mx-ast'?: string;
}
export interface SandboxEnvironment {store: DataflowStore; api: ArtifactApiConfig}
export function sandboxDocument(api: ArtifactApiConfig): string {
  const urls=Object.values(api.libraries);
  const origin=api.resolveUrl ? new URL(api.resolveUrl).origin : urls.length ? new URL(urls[0]).origin : null;
  if(origin && !/^https?:\/\//.test(origin)) throw new Error('Invalid sandbox origin');
  if(api.resolveUrl && (!/^\/a\/[A-Za-z0-9]{6}\/resolve$/.test(new URL(api.resolveUrl).pathname)
    || new URL(api.resolveUrl).search || new URL(api.resolveUrl).hash || new URL(api.resolveUrl).username || new URL(api.resolveUrl).password)) throw new Error('Invalid sandbox resolver');
  const pinned=origin?libraryUrls(origin):{};
  if(Object.entries(api.libraries).some(([name,url])=>pinned[name]!==url)) throw new Error('Invalid sandbox library');
  const policy=["default-src 'none'",`script-src 'unsafe-inline'${urls.length?' '+urls.join(' '):''}`,
    `connect-src${api.resolveUrl?' '+api.resolveUrl:''} blob: data:`,"style-src 'unsafe-inline'",
    'img-src blob: data:',"frame-src 'none'","worker-src 'none'","form-action 'none'","base-uri 'none'"].join('; ');
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style>'
    + '</head><body><script>'+artifactApiScript(api)+AUTHOR_SCRIPT_BOOTSTRAP+'</script></body></html>';
}
export function SandboxView({html,script,title,height,id,className,store,api,'data-mx-ast':ast}: SandboxProps & SandboxEnvironment) {
  const host=useRef<HTMLDivElement>(null);
  const valid=typeof html==='string' && html.length<=262144 && typeof script==='string' && script.length<=262144;
  const {label,pixels}=managedFrameLayout(title,height,'Interactive sandbox');
  const configuration=JSON.stringify(api);
  useEffect(()=>{
    if(!host.current || !valid) return;
    return startAuthorScript(script,store,host.current.ownerDocument,{host:host.current,title:label,html,document:sandboxDocument(api)});
  },[html,script,label,store,configuration,valid]);
  return <div ref={host} id={id} className={className} data-mx-ast={ast} data-mx-sandbox="" aria-label={label} style={{height:pixels,width:'100%'}}/>;
}
