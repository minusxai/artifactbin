import {test} from 'node:test';import assert from 'node:assert/strict';import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const base={coreUrl:'/af/v1/core.js'};
test('static Mermaid-only source owns its bounded preparation plan',()=>{
 const result=admitLocalSource({...base,source:'<Mermaid id="chart" code="flowchart LR; A-->B" title="Flow"/>',mermaids:[{id:'forged',code:'graph TD; X-->Y'}]});
 assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.plan.input.mermaids,[{id:'chart',code:'flowchart LR; A-->B',title:'Flow'}]);
 for(const source of ['<Mermaid id="chart" code={window.code}/>','<Mermaid id="chart" code="flowchart LR; A-->B" run="$save"/>','<Helmet><Value name="show" type="boolean" default={true}/></Helmet>{$show && <Mermaid id="chart" code="flowchart LR; A-->B"/>}'])assert.equal(admitLocalSource({...base,source}).ok,false);
});

import {parseFragment} from 'parse5';import {reconcileMermaidHtml} from '../src/migration/conversion/compiled/mermaid-output.ts';
test('diagram output must preserve the measured pending figure and exact caption',()=>{
 const plan=[{id:'diagram',code:'flowchart LR; A-->B',title:'Flow'}];
 const html='<figure id="diagram" data-mx-mermaid-state="pending"><figcaption>Flow</figcaption><p>Rendering diagram…</p></figure>';
 assert.equal(reconcileMermaidHtml(parseFragment(html),plan),true);
 for(const changed of [html.replace('id="diagram"','id="other"'),html.replace('>Flow<','>Changed<'),html.replace('<figure','<div').replace('</figure>','</div>'),html.replace('pending','ready')])assert.equal(reconcileMermaidHtml(parseFragment(changed),plan),false);
 assert.equal(reconcileMermaidHtml(parseFragment(html),[]),false);
});

test('deck miniature diagram figures retain their source caption and isolated archived IDs',()=>{
 const encoded=(v:string)=>[...v].map(c=>c.codePointAt(0)!.toString(16).padStart(6,'0')).join('');
 const plan=[{id:'diagram',code:'flowchart LR; A-->B',title:'Flow'}];
 const main='<figure id="diagram" data-mx-mermaid-state="pending"><figcaption>Flow</figcaption></figure>';
 const preview=`<nav class="mx-rail"><figure id="mx-preview-${encoded('_R_1_')}-${encoded('0.1')}-${encoded('diagram')}" data-mx-mermaid-state="pending"><figcaption>Flow</figcaption></figure></nav>`;
 assert.equal(reconcileMermaidHtml(parseFragment(main+preview),plan,true),true);
 assert.equal(reconcileMermaidHtml(parseFragment(main+preview),plan),false);
 assert.equal(reconcileMermaidHtml(parseFragment(main+preview.replace('>Flow<','>Changed<')),plan,true),false);
});
