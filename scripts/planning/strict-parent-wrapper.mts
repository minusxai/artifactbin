/** Local reproduction: strict parent CSP, srcdoc versus independent HTTP wrapper. */
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { protectedAuthorDocument } from '../../services/app/lib/story-runtime/author-frame';
import { AUTHOR_SCRIPT_DOCUMENT } from '../../services/app/lib/story-runtime/author-script-bootstrap';

const bundle = await build({ absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', bundle: true, write: false, platform: 'browser', format: 'iife', stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import {startAuthorScript} from './services/app/lib/story-runtime/author-script';
import {createDataflowStore} from './services/app/lib/story-runtime/store';
if(location.pathname.startsWith('/http')) {
  const create=document.createElement.bind(document);
  document.createElement=function(tag,options){const element=create(tag,options);if(tag==='iframe')Object.defineProperty(element,'srcdoc',{set(){element.src='/wrapper';}});return element;};
}
const store=createDataflowStore({flow:{values:[{kind:'scalar',name:'result',type:'string',default:'pending',start:0,end:0}],queries:[]}});
window.result=()=>store.getState().values;
store.subscribe(()=>{document.getElementById('status').textContent=JSON.stringify(store.getState().values)});
const source=location.pathname==='/http-nav'
  ? "let ancestor;try{parent.location.href='http://127.0.0.1:5804/api/fixture?ancestor';ancestor='ALLOWED'}catch(e){ancestor=e.name};mx.params.set('result','ancestor '+ancestor);setTimeout(()=>{location.href='http://127.0.0.1:5804/api/fixture?self'},50);"
  : "let dom;try{void top.document.body;dom='READABLE'}catch(e){dom=e.name};fetch('/api/fixture').then(()=>mx.params.set('result','NETWORK ALLOWED'),()=>mx.params.set('result','ran; DOM '+dom+'; network blocked'));";
let hadFrame=false;
new MutationObserver(()=>{if(document.querySelector('iframe'))hadFrame=true;else if(hadFrame){window.navigationStopped=true;document.getElementById('status').textContent+='; frame removed';}}).observe(document.body,{childList:true});
startAuthorScript(source,store,document);
` } });
let requests=0;
createServer((req,res)=>{
  if(req.url==='/entry.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/wrapper'){res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');res.setHeader('content-security-policy',"sandbox allow-scripts");res.end(protectedAuthorDocument(AUTHOR_SCRIPT_DOCUMENT));return;}
  if(req.url?.startsWith('/api/fixture')){requests++;res.end('fixture');return;}
  if(req.url==='/results'){res.setHeader('content-type','application/json');res.end(JSON.stringify({requests}));return;}
  res.setHeader('content-type','text/html');
  res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"+(req.url==='/http-opaque'?'; sandbox allow-scripts':''));
  res.end('<!doctype html><title>Strict parent wrapper reproduction</title><h1>Strict parent wrapper</h1><p id="status">pending</p><script src="/entry.js"></script>');
}).listen(5804,'127.0.0.1',()=>console.log('Strict parent probe http://127.0.0.1:5804/srcdoc and /http'));
