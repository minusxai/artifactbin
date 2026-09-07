/** Trusted native consent remains inside i. No approval token or form data is
 * ever sent to main: only the server-validated completed callback is reported. */
export async function frameConsent(response:Response,main:string):Promise<Response>{
  const nonce=crypto.randomUUID(),headers=new Headers(response.headers);
  headers.delete('x-frame-options');
  headers.set('content-security-policy',(headers.get('content-security-policy')??'')+`; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors ${main}; base-uri 'none'`);
  const script=`<script nonce="${nonce}">(${consentRuntime.toString()})(${JSON.stringify(main).replace(/</g,'\\u003c')});</script>`;
  return new Response((await response.text()).replace('</body>',script+'</body>'),{status:response.status,headers});
}
function consentRuntime(main:string){
  const send=(type:string,extra:Record<string,unknown>={})=>parent.postMessage({type,...extra},main);
  document.addEventListener('submit',async event=>{
    const form=event.target as HTMLFormElement;
    event.preventDefault();
    if(form.method.toUpperCase()==='GET'){
      const target=new URL('/login',main);
      for(const [key,value] of new FormData(form))if(typeof value==='string')target.searchParams.append(key,value);
      send('mx:controls:navigate',{url:target.href});return;
    }
    const button=form.querySelector('button')!;button.disabled=true;
    const error=document.getElementById('consent-error')??document.createElement('p');
    error.id='consent-error';error.setAttribute('role','alert');error.textContent='';form.append(error);
    try{
      const response=await fetch('/oauth/authorize/approve',{method:'POST',credentials:'same-origin',headers:{accept:'application/json','x-artifactbin-csrf':'1'},body:new FormData(form)});
      const result=await response.json();
      if(!response.ok || typeof result.redirect!=='string')throw new Error(response.status===401?'Your session expired. Reload this page to sign in again.':'This approval expired or was already used. Reload to try again.');
      send('mx:consent:complete',{url:result.redirect});
    }catch(cause){error.textContent=cause instanceof Error?cause.message:'Connection failed. Please retry.';button.disabled=false;}
  });
  send('mx:page:title',{title:document.title});send('mx:page:ready');
}
