/** Compiled into the opaque realm. request is its existing private port RPC.
 * Convenience only: CSP, not these mutable JavaScript wrappers, denies direct
 * destinations. Only async GET through the read-only asset host is supported.
 */
export const MANAGED_FETCH_BOOTSTRAP = `
    const nativeFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
    const nativeXHR = typeof XMLHttpRequest === 'function' ? XMLHttpRequest : null;
    const assetAbort = typeof AbortController === 'function' ? new AbortController() : null;
    let assetOrigin = null, assetActive = 0;
    const assetLocation = input => {
      try { const url=new URL(input); return url.origin===assetOrigin&&!url.username&&!url.password&&!url.hash&&(
        (/^\\/assets\\/[a-f0-9]{64}$/.test(url.pathname)&&[...url.searchParams.keys()].every(key=>key==='v'||key==='w'))||
        (/^\\/assets\\/ref\\/[A-Za-z0-9]{6}$/.test(url.pathname)&&!url.search)); } catch {return false;}
    };
    const installAssetSources = () => {
      if(typeof Element==='undefined'||typeof HTMLImageElement==='undefined'||typeof HTMLScriptElement==='undefined')return;
      const generations=new WeakMap(),nativeAttribute=Element.prototype.setAttribute;
      const descriptor=type=>{let prototype=type.prototype;while(prototype){const found=Object.getOwnPropertyDescriptor(prototype,'src');if(found)return found;prototype=Object.getPrototypeOf(prototype);}};
      const types=[[HTMLScriptElement,'script',descriptor(HTMLScriptElement)],[HTMLImageElement,'image',descriptor(HTMLImageElement)]];
      const assign=(element,value,kind,set)=>{
        const generation=(generations.get(element)||0)+1;generations.set(element,generation);
        const url=String(value);
        if(assetLocation(url)||(kind==='image'&&/^(blob:|data:image\\/(png|jpeg|webp|gif|avif);base64,)/i.test(url))){set.call(element,url);return;}
        if(!assetOrigin){report(new Error('External iframe assets are not configured'));return;}
        void request({op:'asset',url,kind}).then(resolved=>{
          if(assetAbort.signal.aborted||generations.get(element)!==generation)return;
          if(!assetLocation(resolved))throw new Error('Invalid resolved asset URL');set.call(element,resolved);
        }).catch(error=>{report(error);element.dispatchEvent?.(new Event('error'));});
      };
      for(const [type,kind,native] of types)if(native?.set)Object.defineProperty(type.prototype,'src',{...native,set(value){assign(this,value,kind,native.set);}});
      Element.prototype.setAttribute=function(name,value){
        if(String(name).toLowerCase()==='src')for(const [type,kind,native] of types)if(this instanceof type&&native?.set){assign(this,value,kind,native.set);return;}
        return nativeAttribute.call(this,name,value);
      };
    };
    const assetFetch = async (input, init = {}) => {
      if (!nativeFetch) throw new Error('Iframe fetch is unavailable');
      const original = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const method = init.method || (original && original.method) || 'GET';
      const headers = new Headers(init.headers || (original && original.headers) || {});
      if (method.toUpperCase() !== 'GET' || [...headers].length || init.body || init.credentials === 'include' || (original && original.credentials === 'include')) throw new Error('Iframe fetch supports credential-free GET without custom headers only');
      if (assetActive >= 16) throw new Error('Too many iframe fetches');
      assetActive++;
      const abort = new AbortController(),cancel = () => abort.abort();
      const externalSignal = init.signal || (original && original.signal);
      assetAbort.signal.addEventListener('abort',cancel,{once:true});
      externalSignal?.addEventListener('abort',cancel,{once:true});
      if(assetAbort.signal.aborted||externalSignal?.aborted)cancel();
      const timeout = setTimeout(cancel,30000);
      try {
        const inputUrl = new URL(original ? original.url : String(input));
        const local = /^(blob:|data:)$/.test(inputUrl.protocol);
        if ((!local&&!/^https?:$/.test(inputUrl.protocol)&&!/^ref:[A-Za-z0-9]{6}$/.test(inputUrl.href)) || inputUrl.username || inputUrl.password || inputUrl.href.length > 4096) throw new Error('Expected an HTTP(S), ref, blob, or data asset URL');
        if(!local&&!assetOrigin)throw new Error('External iframe assets are not configured');
        const resolved = local?inputUrl.href:assetLocation(inputUrl.href)?inputUrl.href:await request({ op: 'asset', url: inputUrl.href, kind: 'binary' });
        if (!local&&!assetLocation(resolved)) throw new Error('Invalid resolved asset origin');
        const response = await nativeFetch(resolved, { method: 'GET', credentials: 'omit', redirect: 'error', signal: abort.signal });
        const reader = response.body && response.body.getReader();
        const chunks = []; let size = 0;
        if (reader) for (;;) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > 16777216) { await reader.cancel(); throw new Error('Iframe fetch exceeds 16 MiB'); }
          chunks.push(item.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return new Response(size ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
      } finally { clearTimeout(timeout);assetAbort.signal.removeEventListener('abort',cancel);externalSignal?.removeEventListener('abort',cancel);assetActive--; }
    };
    if (nativeFetch) window.fetch = assetFetch;
    if (typeof EventTarget !== 'undefined') window.XMLHttpRequest = class extends EventTarget {
      constructor() { super(); this.readyState=0; this.status=0; this.response=null; this.responseText=''; this.responseType=''; this.withCredentials=false; this.aborted=false;this.timeout=0; }
      emit(name) { const event=new Event(name); this.dispatchEvent(event); if(typeof this['on'+name]==='function')this['on'+name](event); }
      open(method,url,async=true,user,password) { if(String(method).toUpperCase()!=='GET'||async===false||user||password)throw new Error('Iframe XHR supports asynchronous GET only'); this.url=url;this.aborted=false;this.readyState=1;this.emit('readystatechange'); }
      setRequestHeader() { throw new Error('Custom iframe XHR headers are unsupported'); }
      abort() { this.aborted=true;this.controller?.abort();this.emit('abort'); }
      getAllResponseHeaders() { return this.headers || ''; }
      getResponseHeader(name) { return this.responseHeaders ? this.responseHeaders.get(name) : null; }
      send(body) {
        if(body || this.withCredentials || this.timeout || !['','text','json','arraybuffer','blob'].includes(this.responseType))throw new Error('Unsupported iframe XHR options');
        if(this.readyState!==1)throw new Error('Call open before send');this.readyState=2;
        this.controller=new AbortController();
        assetFetch(this.url,{signal:this.controller.signal}).then(async response=>{
          if(this.aborted)return;this.status=response.status;this.responseHeaders=response.headers;
          this.headers=[...response.headers].map(([key,value])=>key+': '+value).join('\\r\\n');
          this.response=this.responseType==='arraybuffer'?await response.arrayBuffer():this.responseType==='blob'?await response.blob():this.responseType==='json'?await response.json():await response.text();
          if(this.aborted)return;if(!this.responseType||this.responseType==='text')this.responseText=this.response;
          this.readyState=4;this.emit('readystatechange');this.emit('load');this.emit('loadend');
        }).catch(()=>{if(!this.aborted){this.readyState=4;this.emit('error');this.emit('loadend');}});
      }
    };
`;
