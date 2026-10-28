/** A real-socket stand-in for the selected server's public platform routes, answered by the app's own handlers: what the
 * installed skill's local preview fetches (lib/skills preview-platform). Requests are recorded for assertions. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {withHttpServer,type RunningServer} from '@artifactbin/test-support/net';
import {GET as core} from '@/app/af/core.js/route';
import {GET as apollo} from '@/app/af/apollo.js/route';
import {GET as reader} from '@/app/af/reader.js/route';
import {GET as chrome} from '@/app/af/chrome.js/route';
import {GET as portable} from '@/app/af/portable.js/route';
import {GET as morph} from '@/app/af/morph.js/route';
import {GET as styles} from '@/app/af/styles.css/route';
import {GET as importMap} from '@/app/af/import-map.json/route';
import {GET as font} from '@/app/af/fonts/[name]/route';
import {GET as component} from '@/app/af/components/[file]/route';

const modules:Record<string,(request:Request)=>Response|Promise<Response>>={'/af/core.js':core,'/af/apollo.js':apollo,'/af/reader.js':reader,'/af/chrome.js':chrome,'/af/portable.js':portable,'/af/morph.js':morph,'/af/styles.css':styles,'/af/import-map.json':importMap};

export async function platformOrigin():Promise<RunningServer&{requests:string[]}>{
 const requests:string[]=[];
 const server=await withHttpServer(async(incoming,reply)=>{
  const url=new URL(incoming.url??'/','https://app.example'),request=new Request(url);requests.push(url.pathname+url.search);
  let answer:Response;
  if(modules[url.pathname])answer=await modules[url.pathname]!(request);
  else if(url.pathname.startsWith('/af/fonts/'))answer=await font(request,{params:Promise.resolve({name:url.pathname.slice('/af/fonts/'.length)})});
  else if(url.pathname.startsWith('/af/components/'))answer=await component(request,{params:Promise.resolve({file:url.pathname.slice('/af/components/'.length)})});
  else if(/^\/libraries\/[a-z][a-z0-9-]*-\d+\.\d+\.\d+\/index\.js$/.test(url.pathname))answer=new Response(await readFile(path.resolve('public',url.pathname.slice(1))),{headers:{'content-type':'text/javascript'}});
  else answer=new Response('Not found',{status:404});
  reply.writeHead(answer.status,Object.fromEntries(answer.headers));reply.end(Buffer.from(await answer.arrayBuffer()));
 });
 return Object.assign(server,{requests});
}
