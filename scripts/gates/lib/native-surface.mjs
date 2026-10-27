/** Complete author-owned HTML for retained browser journeys. */
export function nativeHtml(title,body,{css='',script='',state={}}={}) {
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script src="/af/core.js" data-af="core"></script><script data-af="state" type="application/json">${JSON.stringify(state)}</script><style>html,body{margin:0}body{font:16px system-ui}*{box-sizing:border-box}${css}</style></head><body>${body}${script?`<script type="module">import {client,gql} from '@afbin/apollo';${script}</script>`:''}</body></html>`;
}

/** The same public-client choice behavior is executed by the fixture contract
 * test and by the browser's native author module. */
export function nativeChoiceScript({field,button,output,value,onPaint=''}) {
 if(!/^[_A-Za-z][_0-9A-Za-z]*$/.test(field))throw new Error('Invalid fixture field');
 return `const choiceQuery=gql\`{${field}}\`;async function paintChoice(){const value=(await client.query({query:choiceQuery})).data.${field};document.querySelector(${JSON.stringify(output)}).textContent=String(value);${onPaint}}document.querySelector(${JSON.stringify(button)}).onclick=async()=>{await client.updateQuery({query:choiceQuery},()=>({${field}:${JSON.stringify(value)}}));await paintChoice()};await paintChoice();`;
}
