import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {chromium} from 'playwright';
const capture=process.argv[2];
const server=spawn(process.execPath,['scripts/planning/ocean-workload-perf.mjs',capture,'chromium','1','1','--interactive',...process.argv.slice(3)],{stdio:['ignore','pipe','inherit']});
const lines=createInterface({input:server.stdout});const [line]=await once(lines,'line');const {host}=JSON.parse(line);
const diagnosticNoIsolation=process.argv.includes('--diagnostic-no-isolation');
const browser=await chromium.launch({headless:false,args:['--use-angle=metal',...(diagnosticNoIsolation?['--disable-features=IsolateSandboxedIframes']:[])]});const result=[];
try{
 for(const shape of ['iframe','wrapper']){
  const context=await browser.newContext({viewport:{width:960,height:720}}),page=await context.newPage();
  for(let n=0;n<10;n++){
   const ready=page.waitForEvent('console',{predicate:m=>m.text()==='AFBIN_BOOT',timeout:3000}).then(()=>true,()=>false);
   await page.goto(host+'/'+shape+'?n=1');const boot=await ready;
   result.push({shape,n,boot,frames:page.frames().length});console.error(JSON.stringify(result.at(-1)));
   if(!boot){const cdp=await context.newCDPSession(page);result.at(-1).targets=(await cdp.send('Target.getTargets')).targetInfos;result.at(-1).frameTree=await cdp.send('Page.getFrameTree');await cdp.detach();}
  }
  await context.close();
 }
 console.log(JSON.stringify({browser:browser.version(),diagnosticNoIsolation,staticAuthor:process.argv.includes('--static-author'),result},null,2));
}finally{await browser.close();server.kill('SIGINT');await once(server,'exit');lines.close();}
