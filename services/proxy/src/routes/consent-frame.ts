/** Trusted native consent remains inside i. No approval token or form data is
 * ever sent to main: only the server-validated completed callback is reported. */
export async function frameConsent(response:Response,main:string):Promise<Response>{
  const nonce=crypto.randomUUID(),headers=new Headers(response.headers);
  headers.delete('x-frame-options');
  headers.set('content-security-policy',(headers.get('content-security-policy')??'')+`; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors ${main}; base-uri 'none'`);
  const script=`<script nonce="${nonce}">(${consentRuntime.toString()})(${JSON.stringify(main).replace(/</g,'\\u003c')},{parent,document,FormData});</script>`;
  return new Response((await response.text()).replace('</body>',script+'</body>'),{status:response.status,headers});
}
// These are this script's private host capabilities, not ambient DOM types.
// Node-only consumers compile the emitter without importing browser globals.
interface ConsentNotice {
  id:string;textContent:string|null;setAttribute(name:string,value:string):void;
}
interface ConsentForm {
  method:string;querySelector(selector:'button'):{disabled:boolean}|null;
  append(node:ConsentNotice):void;
}
interface ConsentHost {
  parent:{postMessage(message:unknown,target:string):void};
  document:{
    title:string;
    addEventListener(type:'submit',listener:(event:{target:unknown;preventDefault():void})=>void):void;
    getElementById(id:string):ConsentNotice|null;
    createElement(tag:'p'):ConsentNotice;
  };
  FormData:new(form:ConsentForm)=>FormData;
}
function consentRuntime(main:string,host:ConsentHost){
  const {parent,document,FormData:BrowserFormData}=host;
  const send=(type:string,extra:Record<string,unknown>={})=>parent.postMessage({type,...extra},main);
  document.addEventListener('submit',async event=>{
    const form=event.target as ConsentForm;
    event.preventDefault();
    if(form.method.toUpperCase()==='GET'){
      const target=new URL('/login',main);
      for(const [key,value] of new BrowserFormData(form))if(typeof value==='string')target.searchParams.append(key,value);
      send('mx:controls:navigate',{url:target.href});return;
    }
    const button=form.querySelector('button')!;button.disabled=true;
    const error=document.getElementById('consent-error')??document.createElement('p');
    error.id='consent-error';error.setAttribute('role','alert');error.textContent='';form.append(error);
    try{
      const response=await fetch('/oauth/authorize/approve',{method:'POST',credentials:'same-origin',headers:{accept:'application/json','x-artifactbin-csrf':'1'},body:new BrowserFormData(form)});
      const result:unknown=await response.json();
      if(!response.ok || !result || typeof result!=='object' || !('redirect' in result) || typeof result.redirect!=='string')throw new Error(response.status===401?'Your session expired. Reload this page to sign in again.':'This approval expired or was already used. Reload to try again.');
      send('mx:consent:complete',{url:result.redirect});
    }catch(cause){error.textContent=cause instanceof Error?cause.message:'Connection failed. Please retry.';button.disabled=false;}
  });
  send('mx:page:title',{title:document.title});send('mx:page:ready');
}
