/** Immediate reader behavior, lazy author imports, and the same client in a portable offline file. */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchChromium} from './lib/browser.mjs';
import {connectAgent} from './lib/account-connection.mjs';
import {documentFrame} from './lib/page-facts.mjs';
import {createChecker} from './lib/assert.mjs';
const base=process.argv[2]??'http://localhost:3030',check=createChecker('native-core');
const connection=await connectAgent(base),browser=await launchChromium(),directory=await mkdtemp(path.join(tmpdir(),'af-portable-'));
const publish=async body=>{const res=await fetch(base+'/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${connection.token}`,'content-type':'application/json','Idempotency-Key':`native_core_${randomUUID().replaceAll('-','')}`},body:JSON.stringify({visibility:'public',...body})});if(!res.ok)throw Error(`publish ${res.status}`);return res.json();};
const dataset=await publish({dataset:[{value:7}]});
const body='<p data-af-id="words">The reader works before the author engine loads.</p><button id="start">Load client</button><output id="count"></output><button id="remote">Read shared data</button><output id="status"></output>';
const script=`document.querySelector('#start').onclick=async()=>{const {client,gql}=await import('@afbin/apollo');const query=gql\`{count}\`;await client.updateQuery({query},({count})=>({count:count+1}));document.querySelector('#count').textContent=(await client.query({query})).data.count;document.querySelector('#remote').onclick=async()=>{document.querySelector('#status').textContent=JSON.stringify(await client.query({query:gql\`{orders{rows{value}}}\`}))}}`;
const html=`<!doctype html><html><head><script data-af="core" src="/af/core.js"></script><script type="application/json" data-af="state">{"count":3}</script><link rel="af-dataset" data-af-name="orders" href="ref:${dataset.id}"></head><body>${body}<script>${script}</script></body></html>`;
try{
 const doc=await publish({html}),page=await browser.newPage();let authorRequests=0,relayRequests=0;
 page.on('request',request=>{if(new URL(request.url()).pathname==='/af/apollo.js')authorRequests++;if(request.url().endsWith(`/api/artifacts/${doc.id}/graphql`))relayRequests++;});
 await page.goto(`${base}/a/${doc.id}`,{waitUntil:'load'});const frame=await documentFrame(page);
 await frame.locator('[data-af="presence-overlay"]').waitFor();
 check(authorRequests===0,'reader/comments/presence initialize without fetching the author engine');
 await frame.locator('#start').click();await frame.locator('#count').filter({hasText:'4'}).waitFor();
 check(authorRequests===1,'first actual author import fetches the one author module');
 check(await frame.locator('#count').textContent()==='4','lazy client initializes and updates private viewer state');
 await frame.locator('#remote').click();await frame.locator('#status').filter({hasText:'data'}).waitFor();
 check(relayRequests===1,'lazy client reuses the already attached trusted parent relay');
 const downloaded=await fetch(`${base}/a/${doc.id}/download`);if(!downloaded.ok)throw Error(`download ${downloaded.status}`);
 const file=path.join(directory,'portable.html');await writeFile(file,await downloaded.text());
 const offline=await browser.newContext({offline:true}),local=await offline.newPage();let network=0;
 local.on('request',request=>{if(/^https?:/.test(request.url()))network++;});
 await local.goto(pathToFileURL(file).href);await local.locator('#start').click();await local.locator('#count').filter({hasText:'4'}).waitFor();
 check(await local.locator('#count').textContent()==='4','download initializes the same client without a network');
 await local.locator('#remote').click();await local.locator('#status').filter({hasText:'offline'}).waitFor();
 check(network===0,'portable author module and reader have no network dependencies');
 check((await local.locator('#status').textContent()).includes('offline'),'downloaded remote requests report offline without sending');
 await offline.close();
 // Exact initial code is admitted without permitting newly inserted inline code.
 const policyScript=`window.initialClassic=true;window.tryInline=()=>{const node=document.createElement('script');node.textContent='window.unadmittedInline=true';document.head.appendChild(node);return window.unadmittedInline===true;};window.tryEval=()=>{try{new Function('return 1')();return true;}catch{return false;}};window.evalAllowed=window.tryEval();window.removePolicy=()=>document.querySelector('meta[data-af="script-policy"]').remove();`;
 const policyHtml=`<!doctype html><html><head></head><body><button id="authored-handler" onclick="this.dataset.clicked='yes'">Known handler</button><script type="text/javascript">${policyScript}</script><script type="module" src="./policy-module.js"></script></body></html>`;
 const policyDoc=await publish({html:policyHtml,publicationBundle:{entryPath:'index.html',files:[{path:'policy-module.js',contentType:'text/javascript',base64:Buffer.from('export const value=17;document.body.dataset.initialModule=String(value);').toString('base64')}]}});
 const policyPage=await browser.newPage();await policyPage.goto(`${base}/a/${policyDoc.id}`,{waitUntil:'load'});const policyFrame=await documentFrame(policyPage);
 await policyFrame.locator('body[data-initial-module="17"]').waitFor();
 check(await policyFrame.evaluate(()=>window.initialClassic===true),'hosted exact initial classic and module code execute');
 check(await policyFrame.evaluate(()=>window.tryInline()===false&&window.evalAllowed===false),'hosted new inline code and eval stay refused');
 await policyFrame.locator('#authored-handler').click();check(await policyFrame.locator('#authored-handler').getAttribute('data-clicked')==='yes','exact authored inline handlers retain their behavior');
 await policyFrame.evaluate(()=>window.removePolicy());check(await policyFrame.evaluate(()=>window.tryInline()===false),'removing the policy element does not remove its installed browser policy');
 const policyFile=path.join(directory,'policy-portable.html'),policyDownload=await fetch(`${base}/a/${policyDoc.id}/download`);if(!policyDownload.ok)throw Error(`policy download ${policyDownload.status}`);const portableBytes=await policyDownload.text();
 check(/data:(?:text|application)\/javascript(?:;charset=[^;,]+)?;base64,/.test(portableBytes),'portable local module is actually packed into a data URL');await writeFile(policyFile,portableBytes);
 const policyOffline=await browser.newContext({offline:true}),policyLocal=await policyOffline.newPage();await policyLocal.goto(pathToFileURL(policyFile).href);await policyLocal.locator('body[data-initial-module="17"]').waitFor();
 check(await policyLocal.evaluate(()=>window.initialClassic===true&&window.tryInline()===false&&window.evalAllowed===false),'portable initial classic and packaged data module run while new inline/eval stay refused');
 await policyLocal.locator('#authored-handler').click();check(await policyLocal.locator('#authored-handler').getAttribute('data-clicked')==='yes','portable exact authored handler retains its behavior');
 const chooserPromise=policyLocal.waitForEvent('filechooser'),savedPromise=policyLocal.waitForEvent('download');
 await policyLocal.getByRole('button',{name:'Save HTML',exact:true}).click();await (await chooserPromise).setFiles(policyFile);
 const saved=await savedPromise,savedFile=path.join(directory,'policy-saved.html');await saved.saveAs(savedFile);
 const savedPage=await policyOffline.newPage();await savedPage.goto(pathToFileURL(savedFile).href);await savedPage.locator('body[data-initial-module="17"]').waitFor();
 check(await savedPage.evaluate(()=>window.initialClassic===true&&window.tryInline()===false&&window.evalAllowed===false),'portable Save HTML and reopen retain the platform nonce and initial script admission');await policyOffline.close();
 const diagnosticScript=`const dyn=u=>import(u);window.policyResult=Promise.all([dyn(['data:text/javascript','export default 1'].join(',')).then(()=>true,()=>false),dyn(URL.createObjectURL(new Blob(['export default 1'],{type:'text/javascript'}))).then(()=>true,()=>false)]);`;
 const diagnostic=await publish({html:`<html><body><script type="module">${diagnosticScript}</script></body></html>`}),diagnosticPage=await browser.newPage();await diagnosticPage.goto(`${base}/a/${diagnostic.id}`,{waitUntil:'load'});const diagnosticFrame=await documentFrame(diagnosticPage);await diagnosticFrame.waitForFunction(()=>window.policyResult!==undefined);
 const [dataAllowed,blobAllowed]=await diagnosticFrame.evaluate(()=>window.policyResult);check(!dataAllowed&&blobAllowed,'hosted data module refusal and blob module execution retain original policy');
 // A raw authored page may load the documented core before publication. It gains no parent authority.
 const preview=createServer((_request,response)=>{response.setHeader('content-type','text/html');response.end(`<!doctype html><html><head><script src="${base}/af/core.js" data-af="core"></script><script type="application/json" data-af="state">{"count":3}</script></head><body>${body}<script>${script}</script></body></html>`)});
 await new Promise(resolve=>preview.listen(0,'127.0.0.1',resolve));
 const standalone=await browser.newPage();
 try{await standalone.goto(`http://127.0.0.1:${preview.address().port}/standalone.html`);await standalone.locator('#start').click();await standalone.locator('#count').filter({hasText:'4'}).waitFor();}
 finally{await new Promise(resolve=>preview.close(resolve));}
 check(await standalone.locator('#count').textContent()==='4','a raw script-only authored page needs no injected runtime block');
}finally{await browser.close();await rm(directory,{recursive:true,force:true});}
check.done();
