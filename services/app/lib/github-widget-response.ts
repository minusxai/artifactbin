import { createHash } from 'node:crypto';
import { REPO_URL } from './repo';
import { GITHUB_WIDGET_SANDBOX } from './github-star';

// Vendor code stays in an opaque-origin sandbox, even when this URL is opened
// directly. No credentials or user-controlled URLs are rendered into the page.
const bootstrap = `const options=new URLSearchParams(location.hash.slice(1));
const link=document.querySelector('a');
link.setAttribute('data-show-count',options.get('data-show-count')==='true'?'true':'false');
link.setAttribute('data-color-scheme',options.get('data-color-scheme')==='dark'?'dark':'light');
let acknowledged=false,retry,attempts=0;
const report=()=>{clearTimeout(retry);const widget=document.body.querySelector('span');if(!widget)return;const r=widget.getBoundingClientRect();if(r.width>0&&r.height>0){parent.postMessage({type:'github-widget-size',width:r.width,height:r.height},'*');if(!acknowledged&&attempts++<40)retry=setTimeout(report,250);}};
const observer=new ResizeObserver(report);observer.observe(document.body);
new MutationObserver(()=>{const widget=document.body.querySelector('span');if(widget)observer.observe(widget);report();}).observe(document.body,{childList:true});
addEventListener('message',event=>{if(event.source!==parent)return;if(event.data==='github-widget-size-ack'){acknowledged=true;clearTimeout(retry);}else if(event.data==='github-widget-measure')report();});`;

export function githubWidgetResponse(): Response {
  const hash = createHash('sha256').update(bootstrap).digest('base64');
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><style>html,body{margin:0;background:transparent}body{display:block;width:max-content;height:28px;white-space:nowrap;font-size:0;line-height:0}body>span{display:inline-block;vertical-align:top}</style></head><body><a class="github-button" href="${REPO_URL}" data-size="large" aria-label="Star artifactbin on GitHub">Star</a><script>${bootstrap}</script><script src="https://buttons.github.io/buttons.js"></script></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': `default-src 'none'; sandbox ${GITHUB_WIDGET_SANDBOX}; script-src 'sha256-${hash}' https://buttons.github.io/buttons.js; connect-src https://api.github.com; style-src 'unsafe-inline'; img-src data:; frame-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
