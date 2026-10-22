import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'acorn';
import jsx from 'acorn-jsx';
import {readSlideDeckPlan,admitSlideDeckComponent} from '../src/migration/conversion/compiled/slide-deck.ts';
const parse=(s:string)=>Parser.extend(jsx()).parseExpressionAt('<>'+s+'</>',0,{ecmaVersion:'latest'});
test('deck source contract preserves ordered authored identities and archived title fallback',()=>{
 assert.deepEqual(readSlideDeckPlan(parse('<SlideDeck><Slide id="first" title="  Intro  "><h1>Ignored</h1></Slide><Slide><h2>Second <em>part</em></h2></Slide><Slide><p>Body</p></Slide></SlideDeck>')),{slides:[{id:'first',title:'Intro'},{title:'Second part'},{title:'Slide 3'}]});
 assert.equal(readSlideDeckPlan(parse('<p>ordinary</p>')),undefined);
});
test('deck structure cannot grow dynamic or nested slide navigation',()=>{
 for(const s of ['<Slide><Slide/></Slide>','<For each={$rows}><Slide/></For>','{$open && <Slide/>}','<Slide title={$name}/>'])assert.throws(()=>readSlideDeckPlan(parse(s)));
 assert.throws(()=>admitSlideDeckComponent('Slide',{title:'A',run:'$save'}));
 assert.throws(()=>admitSlideDeckComponent('SlideDeck',{run:'$save'}));
 assert.doesNotThrow(()=>admitSlideDeckComponent('Slide',{id:'s',title:'A',className:'p-4',style:{color:'red'}}));
});

import {parseFragment} from 'parse5';
import {reconcileSlideDeckHtml} from '../src/migration/conversion/compiled/slide-deck-output.ts';
test('compiler output cannot replace slides or omit the navigation it claims',()=>{
 const plan={slides:[{id:'one',title:'First'},{title:'Second'}]};
 const html='<div class="mx-deck"><nav class="mx-rail"><button class="mx-rail-row" aria-label="Go to slide 1: First"></button><button class="mx-rail-row" aria-label="Go to slide 2: Second"></button></nav><div class="mx-doc"><section id="one" data-mx-slide></section><section data-mx-slide></section></div><div class="mx-present"></div></div>';
 assert.equal(reconcileSlideDeckHtml(parseFragment(html),plan),true);
 for(const changed of [html.replace('id="one"','id="other"'),html.replace('class="mx-present"','class="missing"'),html.replace('slide 2: Second','slide 2: Changed')])assert.equal(reconcileSlideDeckHtml(parseFragment(changed),plan),false);
 assert.equal(reconcileSlideDeckHtml(parseFragment(html),undefined),false);
});
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
test('deck-only source owns its plan and does not accept caller-invented slides',()=>{
 const admitted=admitLocalSource({source:'<SlideDeck><Slide title="Only"><p>Body</p></Slide></SlideDeck>',coreUrl:'/af/v1/core.js',slideDeck:{slides:[{id:'forged',title:'Forged'}]}});
 assert.equal(admitted.ok,true);
 if(admitted.ok)assert.deepEqual(admitted.plan.input.slideDeck,{slides:[{title:'Only'}]});
 assert.equal(admitLocalSource({source:'<SlideDeck><p>Empty</p></SlideDeck>',coreUrl:'/af/v1/core.js'}).ok,false);
});
