import assert from 'node:assert/strict';

const stats=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {n:sorted.length,p50:+sorted[Math.floor(sorted.length*.5)].toFixed(2),p95:+sorted[Math.floor(sorted.length*.95)].toFixed(2),max:+sorted.at(-1).toFixed(2)};
};
/** Optional real-product experiment. Uses the gate's disposable authenticated
 * browser, with the SAME stored operation and server for both transport paths. */
export async function measureInteraction({page,base,controls,publish,engineName}) {
  const dataset=await publish({dataset:[{n:0}],access:'readwrite'});
  const document=await publish({markup:`<Helmet><Value name="count" type="number" default={0}/><Mutation name="local">{\`update _signals set count=count+1\`}</Mutation><Mutation name="persist">{\`update ref_${dataset.id} set n=n+1\`}</Mutation></Helmet><h1>Transport benchmark</h1><p>{$count}</p><Button run="$local">Local</Button><Button run="$persist">Persist</Button>`});
  const context=await page.context().browser().newContext({ignoreHTTPSErrors:true,storageState:await page.context().storageState(),viewport:{width:1280,height:900}});
  const measured=await context.newPage();
  const wire=[];
  measured.on('request',request=>{
    if(new URL(request.url()).pathname.endsWith('/mutate')) wire.push(request.url());
  });
  const start=performance.now();
  await measured.goto(`${base}/a/${document.id}`);
  await measured.waitForFunction(()=>!!window.mx && !document.querySelector('button[disabled]'));
  const frame=measured.frameLocator('iframe[title="Artifact controls"]');
  await frame.getByRole('button',{name:'Open artifact controls',exact:true}).waitFor();
  const readyMs=performance.now()-start;
  const output={engine:engineName,readyMs:+readyMs.toFixed(2),note:'localhost, warm serial writes, no CPU/network throttling; direct baseline runs inside trusted iframe, not a public bypass',operations:{}};
  for(const mutation of ['local','persist']) {
    const direct=[],relay=[];
    // Stay within the real 60/min mutation budget, including the surrounding gate.
    // Alternate order, discard two warmup pairs; six measured samples per path.
    for(let i=0;i<8;i++) {
      for(const kind of i%2 ? ['relay','direct'] : ['direct','relay']) {
        const ms=kind==='direct' ? await frame.locator('body').evaluate(async(_,args)=>{
          const start=performance.now();
          const response=await fetch(`/a/${args.id}/mutate`,{method:'POST',headers:{'content-type':'application/json','x-artifactbin-csrf':'1'},body:JSON.stringify({mutation:args.mutation,values:{count:0}})});
          const answer=await response.json();
          if(!response.ok || !answer.ok) throw new Error('Direct mutation failed: '+response.status);
          return performance.now()-start;
        },{id:document.id,mutation}) : await measured.evaluate(async mutation=>{
          const start=performance.now();await window.mx.mutate(mutation);return performance.now()-start;
        },mutation);
        if(i>=2) (kind==='direct'?direct:relay).push(ms);
      }
    }
    output.operations[mutation]={direct:stats(direct),relay:stats(relay),medianDifferenceMs:+(stats(relay).p50-stats(direct).p50).toFixed(2)};
  }
  assert.equal(wire.length,32,'all real mutation requests observed');
  assert(wire.every(url=>new URL(url).origin===controls),'writes only reach trusted origin');
  output.mutationRequests=wire.length;
  output.allWritesOnControlsOrigin=true;
  // Actual inline edit: includes debounce and server commit, not a transport microbenchmark.
  await frame.getByRole('button',{name:'Open artifact controls',exact:true}).click();
  await frame.getByRole('button',{name:'Edit artifact',exact:true}).click();
  const heading=measured.locator('h1[contenteditable="true"]');await heading.waitFor();
  const saved=measured.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname.endsWith('/edits') && r.ok());
  const editStart=performance.now();
  await heading.fill('Transport benchmark edited');await heading.press('Tab');
  await saved;output.editFillToSaveMs=+(performance.now()-editStart).toFixed(2);
  console.log('INTERACTION_PERF '+JSON.stringify(output));
  await context.close();
  return output;
}
