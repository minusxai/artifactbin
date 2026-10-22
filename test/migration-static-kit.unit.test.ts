import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const admit=(source:string)=>admitLocalSource({source,coreUrl:'/af/v1/core.js'});
test('validated static kit and presentation preserve authored identities without invented local state',()=>{
 for(const source of [
  '<Grid id="layout"><GridItem id="tile"><Card id="card"><CardHeader id="header"><CardTitle id="title">Report</CardTitle></CardHeader><CardContent id="body"><Badge id="badge">Ready</Badge></CardContent></Card></GridItem></Grid>',
  '<p id="numbers">{3}{7}</p>',
  '<Tabs id="tabs" defaultValue="first"><TabsList id="list"><TabsTrigger id="trigger" value="first">First</TabsTrigger></TabsList><TabsContent id="content" value="first"><p id="copy">Saved content</p></TabsContent></Tabs>',
 ]){
  const result=admit(source);assert.equal(result.ok,true);if(!result.ok)continue;
  assert.deepEqual(result.plan.manifest.declarations,[]);assert.equal(result.plan.queryNames.size,0);assert.equal(result.plan.author,undefined);
  for(const match of source.matchAll(/\bid="([^"]+)"/g))assert.ok(result.plan.renderedIdentities.has(match[1]!));
 }
});
test('static admission retains existing security, unsupported widget and state-reference refusals',()=>{
 for(const source of ['<UnknownWidget id="widget"/>','<p>{[3,7]}</p>','<Card><p>{[3,7]}</p></Card>','<Card>{{value:3}}</Card>','<SlideDeck><p>Empty</p></SlideDeck>','<Helmet><Value name="n" type="number"/></Helmet><SlideDeck><p>Empty</p></SlideDeck>','<Card id="card" onClick="run()">No</Card>','<Card id="same"><p id="same">Duplicate</p></Card>','<Card><a href="javascript:alert(1)">No</a></Card>','<Card>{doWork()}</Card>','<Tabs id="tabs" value="$missing"/>'])assert.equal(admit(source).ok,false);
});
test('ordinary declared local state and queries remain admitted',()=>{
 const result=admit('<Helmet><Value name="count" type="number" default={1}/><Query name="total">{`select $count + 1 as n`}</Query></Helmet><Card id="card"><p id="count">{$count}</p></Card>');
 assert.equal(result.ok,true);if(result.ok){assert.equal(result.plan.manifest.declarations.length,1);assert.ok(result.plan.queryNames.has('total'));}
});
