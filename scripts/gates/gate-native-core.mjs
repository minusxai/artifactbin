/** Immediate reader behavior, lazy author imports, hosted components, and the portable offline client. */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchChromium} from './lib/browser.mjs';
import {connectAgent} from './lib/account-connection.mjs';
import {documentFrame} from './lib/page-facts.mjs';
import {createChecker} from './lib/assert.mjs';
import {hostedComponentFiles,verifyComponentAssetArchive} from '../lib/component-asset-proof.mjs';
const base=process.argv[2]??'http://localhost:3030',check=createChecker('native-core');
const connection=await connectAgent(base),browser=await launchChromium(),directory=await mkdtemp(path.join(tmpdir(),'af-portable-'));
const publish=async body=>{const res=await fetch(base+'/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${connection.token}`,'content-type':'application/json','Idempotency-Key':`native_core_${randomUUID().replaceAll('-','')}`},body:JSON.stringify({visibility:'public',...body})});if(!res.ok)throw Error(`publish ${res.status}`);return res.json();};
const dataset=await publish({dataset:[{value:7}]});
const body='<p data-af-id="words">The reader works before the author engine loads.</p><button id="start">Load client</button><output id="count"></output><button id="remote">Read shared data</button><output id="status"></output>';
const script=`document.querySelector('#start').onclick=async()=>{const {state}=await import('@afbin/state');const {sql}=await import('@afbin/apollo');await state.setState(({count})=>({count:count+1}));document.querySelector('#count').textContent=state.getState().count;document.querySelector('#remote').onclick=async()=>{document.querySelector('#status').textContent=JSON.stringify(await sql\`select value from orders\`)}}`;
const html=`<!doctype html><html><head><script data-af="core" src="/af/core.js"></script><script type="application/json" data-af="state">{"count":3}</script><link rel="af-dataset" data-af-name="orders" href="ref:${dataset.id}"></head><body>${body}<script>${script}</script></body></html>`;
try{
 const doc=await publish({html}),page=await browser.newPage();let authorRequests=0,relayRequests=0;
 page.on('request',request=>{if(/^\/af\/(?:v1\/runtime\/[a-f0-9]{64}\/)?apollo\.js$/.test(new URL(request.url()).pathname))authorRequests++;if(request.url().endsWith(`/api/artifacts/${doc.id}/sql`))relayRequests++;});
 await page.goto(`${base}/a/${doc.id}`,{waitUntil:'load'});const frame=await documentFrame(page);
 await frame.locator('[data-af="presence-overlay"]').waitFor();
 // A page that imports apollo preloads it beside the reader (fetched, not run): the reader never waits for it.
 check(authorRequests<=1,'reader/comments/presence initialize without waiting for the author engine');
 await frame.locator('#start').click();await frame.locator('#count').filter({hasText:'4'}).waitFor();
 check(authorRequests===1,'first actual author import uses the one preloaded author module');
 check(await frame.locator('#count').textContent()==='4','lazy client initializes and updates private viewer state');
 await frame.locator('#remote').click();await frame.locator('#status').filter({hasText:'7'}).waitFor();
 check(relayRequests===1,'lazy client reuses the already attached trusted parent relay');
 const downloaded=await fetch(`${base}/a/${doc.id}/download`);if(!downloaded.ok)throw Error(`download ${downloaded.status}`);
 const file=path.join(directory,'portable.html');await writeFile(file,await downloaded.text());
 const offline=await browser.newContext({offline:true}),local=await offline.newPage();let network=0;
 local.on('request',request=>{if(/^https?:/.test(request.url()))network++;});
 await local.goto(pathToFileURL(file).href);await local.locator('#start').click();await local.locator('#count').filter({hasText:'4'}).waitFor();
 check(await local.locator('#count').textContent()==='4','download initializes the same client without a network');
 await local.locator('#remote').click();await local.locator('#status').filter({hasText:'7'}).waitFor();
 check(network===0,'portable author module and reader have no network dependencies');
 check((await local.locator('#status').textContent()).includes('7'),'downloaded SQL reads use embedded rows without sending');
 await offline.close();
 // The app's raw reader must resolve the published import map and serve the current build.
 const root=fileURLToPath(new URL('../../',import.meta.url));
 await verifyComponentAssetArchive({root,files:await hostedComponentFiles({root,origin:base})});
 check(true,'served component module closure and bytes match the current build receipt');
 const components=await publish({html:`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
  <af-dialog>
    <af-dialog-trigger>Open review</af-dialog-trigger>
    <af-dialog-content><af-dialog-title>Review changes</af-dialog-title><af-dialog-close>Close review</af-dialog-close></af-dialog-content>
  </af-dialog>
  <af-tabs default-value="one"><af-tabs-list aria-label="Sections">
    <af-tabs-trigger value="one">One</af-tabs-trigger>
    <af-tabs-trigger value="blocked" disabled>Unavailable</af-tabs-trigger>
    <af-tabs-trigger value="two">Two</af-tabs-trigger>
  </af-tabs-list><af-tabs-content value="one">First panel</af-tabs-content><af-tabs-content value="two">Second panel</af-tabs-content></af-tabs>
  <af-select label="Person" options='["Ada","Grace","Linus"]' default-value='"Ada"'></af-select>
  <af-tooltip><af-tooltip-trigger><button>Help</button></af-tooltip-trigger><af-tooltip-content>More information</af-tooltip-content></af-tooltip>
  <af-user fallback="Unassigned"></af-user>
  <af-data-table></af-data-table>
  <script type="module">
    import "@afbin/dialog";
    import "@afbin/tabs";
    import "@afbin/select";
    import "@afbin/tooltip";
    import "@afbin/user";
    import "@afbin/data-table";
    document.querySelector('af-data-table').data={
      columns:[{name:'name',type:'string'},{name:'score',type:'number'}],
      rows:[{name:'Ada',score:92},{name:'Grace',score:98},{name:'Linus',score:85}],
    };
  </script>
 </body></html>`});
 const raw=await browser.newPage(),resourceErrors=[];
 raw.on('pageerror',error=>resourceErrors.push(error.message));
 raw.on('requestfailed',request=>resourceErrors.push(`${request.resourceType()} request failed`));
 raw.on('response',response=>{
   if(response.status()>=400&&['document','script','stylesheet','font'].includes(response.request().resourceType())){
     resourceErrors.push(`${response.request().resourceType()} returned HTTP ${response.status()}`);
   }
 });
 try {
   for(const [mode,viewport] of [['light',{width:800,height:600}],['dark',{width:390,height:844}]]){
     await raw.setViewportSize(viewport);
     await raw.goto(`${base}/a/${components.id}/raw?mx-mode=${mode}`);
     await raw.locator(`html[data-af-dark="${mode==='dark'}"]`).waitFor({state:'attached'});
     const open=raw.getByRole('button',{name:'Open review',exact:true});
     const dialog=raw.getByRole('dialog',{name:'Review changes',exact:true});
     await open.click();
     await dialog.waitFor();
     await raw.keyboard.press('Escape');
     await dialog.waitFor({state:'hidden'});
     check(await open.evaluate(node=>node===document.activeElement),`raw ${mode} dialog restores focus on Escape`);

     const first=raw.getByRole('tab',{name:'One',exact:true,selected:true});
     await first.focus();
     check(await raw.getByRole('tabpanel',{name:'One',exact:true}).isVisible(),`raw ${mode} shows the selected default panel`);
     await raw.keyboard.press('ArrowRight');
     const second=raw.getByRole('tab',{name:'Two',exact:true,selected:true});
     check(await second.evaluate(node=>node===document.activeElement) &&
       await raw.getByRole('tabpanel',{name:'Two',exact:true}).textContent()==='Second panel' &&
       await raw.getByRole('tabpanel',{name:'One',exact:true}).count()===0,
       `raw ${mode} keyboard selection skips the disabled tab and shows the second panel`);

     const person=raw.getByRole('button',{name:'Person',exact:true});
     await person.click();
     check(await raw.getByRole('option',{name:'Ada',exact:true,selected:true}).isVisible(),
       `raw ${mode} select opens with its default option selected`);
     await raw.getByRole('option',{name:'Grace',exact:true}).click();
     check((await person.textContent()).includes('Grace')&&await person.getAttribute('aria-expanded')==='false',
       `raw ${mode} select applies the choice and closes`);

     await raw.getByRole('button',{name:'Help',exact:true}).focus();
     const tooltip=raw.getByRole('tooltip');
     await tooltip.waitFor();
     check(await tooltip.textContent()==='More information',`raw ${mode} tooltip opens on keyboard focus`);
     await raw.keyboard.press('Escape');
     await tooltip.waitFor({state:'hidden'});
     check(await raw.getByText('Unassigned',{exact:true}).isVisible(),`raw ${mode} user fallback is visible`);

     const rows=raw.getByRole('row');
     await raw.getByRole('cell',{name:'Linus',exact:true}).waitFor();
     check(await rows.count()===4,`raw ${mode} table shows the header and all three rows`);
     check(await raw.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`raw ${mode} components fit the viewport`);
   }
   check(resourceErrors.length===0,`raw component reader loads without script or resource errors (${resourceErrors.join('; ')||'none'})`);
 }finally{await raw.close();}
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
