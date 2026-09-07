/** Platform UI only. Author documents, asset bytes and APIs are never app pages. */
export const PAGE_FRAME_PREFIX = '/controls/page';
export function isPlatformPage(path: string): boolean {
  return ['/', '/login', '/account', '/tokens', '/tokens/new', '/trash', '/chat', '/assets', '/datasets/new', '/privacy', '/terms', '/docs-human'].includes(path)
    || /^\/@[\w-]+\/?$/.test(path)
    || /^\/datasets\/[A-Za-z0-9]+\/edit$/.test(path);
}
export function platformFramePage(path: string): string | null {
  if (!path.startsWith(PAGE_FRAME_PREFIX)) return null;
  const page = path.slice(PAGE_FRAME_PREFIX.length);
  return isPlatformPage(page) ? page : null;
}

/** No credential or account data is accepted by this shell. */
export function platformPageResponse(main: string, controls: string, path: string, search: string,folderId?:string): Response {
  const nonce = crypto.randomUUID();
  const consent=path==='/oauth/authorize';
  const params=new URLSearchParams(search);
  if(folderId && !/^[A-Za-z0-9]+$/.test(folderId))throw new Error('Invalid folder id');
  const config = JSON.stringify({main,controls,url:controls+(folderId?'/controls/folder/'+folderId:consent?'/controls/consent':PAGE_FRAME_PREFIX+path)+search,...(consent?{callback:params.get('redirect_uri'),state:params.get('state')??''}:{})}).replace(/</g,'\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>artifactbin</title><style nonce="${nonce}">html,body{margin:0;height:100%;background:#111113;color:#e7e5e4;font:15px system-ui}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent}#loading{position:fixed;inset:0;z-index:2;padding:24px;background:#111113}button{font:inherit;padding:8px 16px}[hidden]{display:none!important}</style></head><body><div id="loading" role="status">Loading artifactbin… <button id="retry" hidden aria-label="Retry loading app">Retry</button></div><iframe id="app-frame" title="Artifactbin app" referrerpolicy="no-referrer" allow="clipboard-write"></iframe><script nonce="${nonce}">(${platformPageRuntime.toString()})(${config},${isPlatformPage.toString()});</script></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src ${controls}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`}});
}

/** Serialized into the credential-free wrapper: no imports or private state. */
function platformPageRuntime(config: {main: string;controls: string;url: string;callback?:string;state?:string},platformPath:(path:string)=>boolean) {
  const frame=document.getElementById('app-frame') as HTMLIFrameElement;
  const loading=document.getElementById('loading')!;
  const retry=document.getElementById('retry') as HTMLButtonElement;
  let timer: ReturnType<typeof setTimeout>;
  const load=()=>{clearTimeout(timer);loading.hidden=false;retry.hidden=true;frame.src=config.url+location.hash;timer=setTimeout(()=>{retry.hidden=false;loading.firstChild!.textContent='The app is taking longer to load. ';},15000);};
  retry.addEventListener('click',load);
  const address=()=>frame.contentWindow?.postMessage({type:'mx:page:hash',hash:location.hash},config.controls);
  window.addEventListener('hashchange',address);
  window.addEventListener('popstate',address);
  window.addEventListener('message',(event: MessageEvent)=>{
    if(event.source!==frame.contentWindow || event.origin!==config.controls)return;
    if(event.data?.type==='mx:page:ready'){clearTimeout(timer);loading.hidden=true;address();return;}
    if(event.data?.type==='mx:page:title' && typeof event.data.title==='string'){document.title=event.data.title.slice(0,300);return;}
    if(event.data?.type==='mx:page:history' && (event.data.delta===-1 || event.data.delta===1)){history.go(event.data.delta);return;}
    if(event.data?.type==='mx:consent:complete' && config.callback && typeof event.data.url==='string'){
      try{
        const expected=new URL(config.callback),target=new URL(event.data.url),code=target.searchParams.get('code');
        if(!code || !['https:','http:'].includes(expected.protocol) || expected.username || expected.password || expected.hash)return;
        expected.searchParams.set('code',code);
        if(config.state)expected.searchParams.set('state',config.state);
        if(expected.href===target.href)location.assign(target.href);
      }catch{/* Only the original callback plus code/state is allowed. */}
      return;
    }
    if(event.data?.type!=='mx:controls:navigate' || typeof event.data.url!=='string')return;
    try {
      const target=new URL(event.data.url);
      if(target.origin!==config.main || target.username || target.password)return;
      if(!platformPath(target.pathname) && target.pathname!=='/oauth/authorize' && !/^\/a\/[A-Za-z0-9]+$/.test(target.pathname) && !/^\/@[\w-]+(?:\/[\w-]+)*\/?$/.test(target.pathname) && !/^\/docs(?:\/[\w.-]+)*\/?$/.test(target.pathname))return;
      if(event.data.replace===true)location.replace(target.href);else location.assign(target.href);
    }catch{/* Invalid requests cannot navigate. */}
  });
  load();
}
