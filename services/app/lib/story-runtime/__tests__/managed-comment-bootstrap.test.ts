import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import {buildSync} from 'esbuild';
import {AUTHOR_SCRIPT_BOOTSTRAP} from '../author-script-bootstrap';

async function exercise(source:string,managed=true) {
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only',url:'https://child.example/'});
  const win=dom.window;
  const messages:any[]=[];
  const port={postMessage:(m:unknown)=>messages.push(m),start(){},close(){},onmessage:null as null|((e:{data:any})=>Promise<void>)};
  try {
    win.eval(source);
    win.dispatchEvent(new win.MessageEvent('message',{source:win as unknown as Window,data:'mx:author:init',ports:[port as unknown as MessagePort]}));
    expect(port.onmessage).toBeTypeOf('function');
    await port.onmessage!({data:{type:'comment-state',generation:'mount',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null}});
    await port.onmessage!({data:{type:'run',source:'',managed,html:'<p data-comment-key="dynamic">Text</p>',scripts:[]}});
    expect(messages.filter(m=>m.type==='author-error')).toEqual([]);
    win.document.querySelector('p')!.click();
    expect(messages.some(m=>m.type==='comment-selection')).toBe(managed);
  }finally{win.dispatchEvent(new win.Event('pagehide'));win.close();}
}
it('executes the shipped bootstrap and only enables comments in visible managed content',async()=>{await exercise(AUTHOR_SCRIPT_BOOTSTRAP);await exercise(AUTHOR_SCRIPT_BOOTSTRAP,false);});
it('executes the production-minified bootstrap without depending on bundler closures',async()=>{
  const built=buildSync({entryPoints:[fileURLToPath(new URL('../author-script-bootstrap.ts',import.meta.url))],bundle:true,minify:true,write:false,format:'iife',globalName:'compiled',platform:'browser',target:'es2022'});
  const source=new Function(built.outputFiles[0].text+';return compiled.AUTHOR_SCRIPT_BOOTSTRAP;')();
  await exercise(source);
});
