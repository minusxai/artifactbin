/** Local-only real-component boundary probe. No accounts or production calls. */
import { createServer } from 'node:http';
import { build } from 'esbuild';

const result = await build({ absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', bundle: true, write: false,
  platform: 'browser', format: 'iife', stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TrustedUi} from './services/app/components/TrustedUi';
import {Tooltip} from './services/app/components/Tooltip';
import {startAuthorScript} from './services/app/lib/story-runtime/author-script';
import {AUTHOR_SCRIPT_DOCUMENT} from './services/app/lib/story-runtime/author-script-bootstrap';
import {createDataflowStore} from './services/app/lib/story-runtime/store';
const flow={values:[{kind:'scalar',name:'width',type:'number',default:0,start:0,end:0},{kind:'scalar',name:'dom',type:'string',default:'pending',start:0,end:0},{kind:'scalar',name:'network',type:'string',default:'pending',start:0,end:0}],queries:[]};
const store=createDataflowStore({flow});
const host=document.getElementById('trusted');
let input=null, button=null, clicks=0;
const root=createRoot(host);
root.render(<TrustedUi mode="light" styles={':host{--qa-safe-color:rgb(0, 0, 255)} button{color:var(--qa-safe-color);font-size:16px}'}><label>Harmless local fixture<input ref={el=>{input=el}} aria-label="QA fixture" defaultValue="qa_alpha_fixture_only" /></label><Tooltip content="Protected tooltip" open><button ref={el=>{button=el}} aria-label="QA action" onClick={()=>{clicks++}}>Action</button></Tooltip></TrustedUi>);
const probe=document.getElementById('probe');
const stop=startAuthorScript("try{void top.document.body;mx.params.set('dom','READABLE')}catch(e){mx.params.set('dom',e.name)};fetch('/api/fixture',{credentials:'include'}).then(()=>mx.params.set('network','ALLOWED'),()=>mx.params.set('network','blocked'));setInterval(()=>mx.params.set('width',innerWidth),50);",store,document,{host:probe,title:'Isolated QA script',html:'',document:AUTHOR_SCRIPT_DOCUMENT});
window.qa={result:()=>({values:store.getState().values,width:probe.getBoundingClientRect().width,controlColor:button?getComputedStyle(button).color:null,lightDomInput:!!document.querySelector('[aria-label="QA fixture"]'),lightDomTooltip:document.body.textContent.includes('Protected tooltip'),shadowMode:input?.getRootNode().mode,clicks}),change:()=>input?.setAttribute('value','qa_beta_fixture_only'),dispose:()=>{stop();root.unmount();}};
` } });
let apiRequests = 0;
const server = createServer((req, res) => {
  if (req.url === '/entry.js') { res.setHeader('content-type', 'text/javascript'); res.end(result.outputFiles[0].text); return; }
  if (req.url === '/api/fixture') { apiRequests++; res.end('dummy'); return; }
  if (req.url === '/results') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ apiRequests })); return; }
  res.setHeader('content-type', 'text/html');
  res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'");
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trusted UI boundary probe</title><style>body{--qa-safe-color:red;color:red}button{color:red!important}body:has(input[value^="qa_alpha"]) #probe{width:101px!important}#probe{width:100px;height:120px}</style><h1>Local trusted UI probe</h1><div id="trusted"></div><div id="probe"></div><script src="/entry.js"></script>');
});
server.listen(5800, '127.0.0.1', () => console.log('Trusted UI probe: http://127.0.0.1:5800'));
