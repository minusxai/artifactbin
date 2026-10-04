/** Spawn the lazy runtime so renderer configuration and browser lifetime stay outside the CLI. */
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostRuntime} from './host-runtime';
import {LOCAL_HTML_ARG} from './entry-args';
import {CliError} from './errors';
import type {LocalHtmlOptions} from './local-html-options';
export async function renderLocalHtml(options:LocalHtmlOptions):Promise<Buffer>{
 const assets=await hostRuntime(options.home);
 const prefix=[join(dirname(fileURLToPath(import.meta.url)),'afbin.mjs')];
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[...prefix,LOCAL_HTML_ARG,JSON.stringify(options),assets],{stdio:['ignore','pipe','pipe']});
  const chunks:Buffer[]=[];let size=0,errors='',interrupted=false;
  const stop=()=>{interrupted=true;child.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>25*1024*1024){stop();reject(new CliError('render_failed','Local HTML exceeds 25 MB.'));}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-16000);});
  child.on('error',reject);
  child.on('close',code=>{
   process.off('SIGINT',stop);process.off('SIGTERM',stop);
   if(interrupted){reject(new CliError('render_failed','Local HTML export was interrupted.'));return;}
   if(code===0&&size>0){resolve(Buffer.concat(chunks));return;}
   let error:{code:string;message:string}|undefined;
   for(const line of errors.trim().split('\n'))try{const value=JSON.parse(line);if(typeof value.code==='string'&&typeof value.message==='string')error=value;}catch{}
   reject(new CliError(error?.code??'render_failed',error?.message??(errors.trim()||'Local renderer stopped before producing HTML.')));
  });
 });
}
export async function startLocalHtmlRuntime(options:LocalHtmlOptions,assets:string):Promise<void>{
 const bootstrap=join(assets,'bootstrap.cjs');
 const host=createRequire(bootstrap)(bootstrap) as {html:(options:LocalHtmlOptions,assets:string)=>Promise<Buffer>};
 const bytes=await host.html(options,assets);
 await new Promise<void>((resolve,reject)=>process.stdout.write(bytes,error=>error?reject(error):resolve()));
}
