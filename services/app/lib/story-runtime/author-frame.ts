/** Trusted wrapper document. Inner content is data, never wrapper script source. */
export function protectedAuthorDocument(innerDocument: string): string {
  const policy=innerDocument.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  const csp=policy??"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const payload=JSON.stringify(innerDocument).replace(/</g,'\\u003c');
  return '<!doctype html><html data-mx-author-wrapper><head><meta http-equiv="Content-Security-Policy" content="'+csp+'"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head><body><script>'+`
  (()=>{
    let initialized=false, loaded=false, pendingPort=null, transferred=false;
    const frame=document.createElement('iframe');
    frame.title='Interactive artifact content';
    frame.setAttribute('sandbox','allow-scripts');
    frame.setAttribute('referrerpolicy','no-referrer');
    const transfer=()=>{
      if(!loaded||!pendingPort||transferred)return;
      transferred=true;
      frame.contentWindow.postMessage('mx:author:init','*',[pendingPort]); pendingPort=null;
    };
    addEventListener('message',event=>{
      if(initialized||event.source!==parent||event.data!=='mx:author:init'||event.ports.length!==1)return;
      initialized=true;pendingPort=event.ports[0];transfer();
    });
    frame.onload=()=>{
      if(loaded){parent.postMessage('mx:author:navigated','*');frame.remove();return;}
      loaded=true;transfer();
    };
    frame.srcdoc=${payload};
    document.body.append(frame);
  })();`+'</script></body></html>';
}
