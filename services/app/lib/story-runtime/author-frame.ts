/** Fixed trusted HTTP document. It never interpolates author source. The
 * response owns its sandbox/CSP, independent from the main app's script policy;
 * the inner srcdoc adds its own stricter policy. */
export const AUTHOR_FRAME_PATH='/story/author-frame';
export const AUTHOR_FRAME_DOCUMENT='<!doctype html><html data-mx-author-wrapper><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head><body><script>'+String.raw`
(()=>{
  let initialized=false, loaded=false, pendingPort=null, transferred=false;
  const frame=document.createElement('iframe');
  frame.title='Interactive artifact content';
  frame.setAttribute('sandbox','allow-scripts');
  frame.setAttribute('referrerpolicy','no-referrer');
  const transfer=()=>{
    if(!loaded||!pendingPort||transferred)return;
    transferred=true;
    frame.contentWindow.postMessage('mx:author:init','*',[pendingPort]);pendingPort=null;
  };
  addEventListener('message',event=>{
    if(initialized||event.source!==parent||event.data?.type!=='mx:author:init'||typeof event.data.document!=='string'||event.ports.length!==1)return;
    initialized=true;pendingPort=event.ports[0];
    frame.onload=()=>{
      if(loaded){parent.postMessage('mx:author:navigated','*');frame.remove();return;}
      loaded=true;transfer();
    };
    frame.srcdoc=event.data.document;
    document.body.append(frame);
  });
})();
`+'</script></body></html>';
