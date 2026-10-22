import test from 'node:test';
import assert from 'node:assert/strict';
import {admitPresentationKit} from '../src/migration/conversion/compiled/presentation-kit.ts';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
test('frozen Collapsible is a viewer-local direct presentation shell with stable mounted child identities',()=>{
 assert.deepEqual(admitPresentationKit('Collapsible',{defaultOpen:true,id:'shell'}),{tag:'Collapsible',identity:'direct',conditionalChildren:false,portal:false});
 assert.equal(admitPresentationKit('CollapsibleContent',{forceMount:false},['Collapsible']).conditionalChildren,false);
 const result=admitLocalSource({source:'<Tabs id="tabs" defaultValue="first"><TabsList><TabsTrigger value="first">First</TabsTrigger></TabsList><TabsContent value="first"><Collapsible id="shell"><CollapsibleTrigger id="toggle">Details</CollapsibleTrigger><CollapsibleContent id="panel"><p id="copy">Saved</p></CollapsibleContent></Collapsible></TabsContent></Tabs>',coreUrl:'/af/v1/core.js'});
 assert.equal(result.ok,true);if(result.ok)for(const id of ['shell','toggle','panel','copy'])assert.ok(result.plan.renderedIdentities.has(id));
});
test('disclosure preserves exact static API and refuses missing context, executable props and undeclared controlled state',()=>{
 for(const [tag,attrs,ancestors] of [['CollapsibleTrigger',{},[]],['CollapsibleContent',{},[]],['Collapsible',{open:'$unknown'},[]],['Collapsible',{onOpenChange:'run'},[]],['Collapsible',{defaultOpen:'yes'},[]],['CollapsibleTrigger',{asChild:true},['Collapsible']],['CollapsibleContent',{forceMount:'yes'},['Collapsible']]] as const)assert.throws(()=>admitPresentationKit(tag,attrs,ancestors));
 for(const source of ['<CollapsibleTrigger/>','<Collapsible><CollapsibleTrigger onClick="run()"/></Collapsible>','<Collapsible open="$unknown"/>'])assert.equal(admitLocalSource({source,coreUrl:'/af/v1/core.js'}).ok,false);
 // Required values remain required; no identities or synthetic values repair malformed source.
 assert.throws(()=>admitPresentationKit('AccordionItem',{id:'item'},['Accordion']));
});
test('frozen Accordion accepts multiple spelling without inventing array state, and Dialog asChild remains an inert boolean hint',()=>{
 assert.equal(admitPresentationKit('Accordion',{type:'multiple'}).tag,'Accordion');
 for(const tag of ['DialogTrigger','DialogClose']){
  assert.equal(admitPresentationKit(tag,{asChild:true},['Dialog']).tag,tag);
  assert.throws(()=>admitPresentationKit(tag,{asChild:'true'},['Dialog']));
 }
 assert.throws(()=>admitPresentationKit('Accordion',{type:'invalid'}));
 assert.throws(()=>admitPresentationKit('Accordion',{type:'multiple',value:['first','second']}));
});
