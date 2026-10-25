/** Literal runtime: children have opaque origins and no credential or parent bridge.
 * Resource URLs are exact host-receipted assets; never inherit runner/platform access.
 */
export const NATIVE_OBSERVER_PREVIEW_RUNTIME=String.raw`function installPreview(document,urlApi,BlobType,plan){
 let active=true,serial=0;
 const urls=new Set(),frames=new Set();
 const ensure=()=>{if(!active)throw Error('Preview disposed');};
 const revoke=url=>{if(!urls.delete(url))return;urlApi.revokeObjectURL(url);};
 const reset=()=>{for(const frame of frames)frame.remove();frames.clear();for(const url of [...urls])revoke(url);};
 const dispose=()=>{if(!active)return;active=false;reset();document.defaultView?.removeEventListener('pagehide',hide);};
 const hide=event=>{if(!event.persisted)dispose();};
 const allowed=new Set(plan.resources.map(resource=>resource.target));
 const attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
 const assetPolicy=plan.resources.map(resource=>{const target=resource.target;if(!/^(\/?assets\/|https?:\/\/)/.test(target)||/[\s;'"<>]/.test(target)||!/^([a-f0-9]{64})$/.test(resource.sha256))throw Error('Invalid preview resource');return new URL(target,document.baseURI).href;}).join(' ');
 const csp="default-src 'none'; script-src blob: 'unsafe-inline' "+assetPolicy+"; style-src 'unsafe-inline' "+assetPolicy+"; img-src data: blob: "+assetPolicy+"; font-src data: "+assetPolicy+"; media-src data: blob: "+assetPolicy+"; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 document.defaultView?.addEventListener('pagehide',hide);
 return {
  createScriptUrl:source=>{ensure();if(typeof source!=='string')throw Error('Invalid preview script');const url=urlApi.createObjectURL(new BlobType([source],{type:'text/javascript'}));urls.add(url);return url;},
  revokeScriptUrl:revoke,
  createFrame:()=>{ensure();const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts allow-popups');frame.setAttribute('credentialless','');frame.setAttribute('referrerpolicy','no-referrer');frame.setAttribute('data-af-id',plan.sourceNodeId+'-preview-'+(++serial));frames.add(frame);return frame;},
  setDocument:(frame,html)=>{ensure();if(!frames.has(frame))throw Error('Unowned preview frame');if(typeof html!=='string')throw Error('Invalid preview document');let mapped=html;for(const resource of [...plan.resources].sort((a,b)=>b.source.length-a.source.length))mapped=mapped.split(resource.source).join(resource.target);
   const references=[...mapped.matchAll(/(?:\b(?:src|poster)\s*=\s*["']([^"']+)["']|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)'";]+))/gi)].map(match=>match[1]||match[2]||match[3]);
   if(references.some(value=>!value.startsWith('#')&&!value.startsWith('data:')&&!urls.has(value)&&!allowed.has(value)))throw Error('Unadmitted preview resource');
   if(/\bhref\s*=\s*["']ref:/.test(mapped))throw Error('Unadmitted preview navigation');
   const policy='<meta http-equiv="Content-Security-Policy" content="'+attr(csp)+'">';
   frame.srcdoc='<!doctype html>'+policy+mapped;
  },reset,dispose
 };
}`;
