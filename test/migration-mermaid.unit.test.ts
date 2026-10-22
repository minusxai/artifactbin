import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admitMermaid} from '../src/migration/conversion/compiled/mermaid-admission.ts';
import {sanitizeMermaidSvg} from '../src/migration/conversion/compiled/mermaid-svg.ts';
test('Mermaid admission preserves static flowchart props and refuses open shell/engine capabilities',()=>{
 assert.deepEqual(admitMermaid({id:'diagram',title:'Flow',code:'flowchart LR; A-->B'}),{id:'diagram',title:'Flow',code:'flowchart LR; A-->B'});
 for(const props of [{code:'flowchart LR; A-->B'},{id:'m',code:'%%{init: {}}%%\nflowchart LR; A-->B'},{id:'m',code:'classDiagram; A-->B'},{id:'m',code:'flowchart LR; A-->B',onClick:'run'},{id:'m',code:'flowchart LR; A@{img: "https://example.test/x"}'},{id:'m',code:'flowchart LR; A-->B',imageKey:'other'},{id:'m',code:'x'.repeat(20001)}])assert.throws(()=>admitMermaid(props));
});
test('inline diagrams accept only bounded inert SVG with local references and scoped paint',()=>{
 const good='<svg id="diagram" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><style>#diagram text{fill:red}</style><defs><marker id="arrow"><path d="M0 0L1 1"/></marker></defs><g id="content"><path marker-end="url(#arrow)" d="M0 0L10 10"/><text>https://example.test is plain text</text></g></svg>';
 assert.match(sanitizeMermaidSvg(good).svg,/plain text/);
 for(const svg of ['<svg><script>alert(1)</script></svg>','<svg onload="x()"/>','<svg><foreignObject><div>x</div></foreignObject></svg>','<svg><image href="https://example.test/x"/></svg>','<svg><style>@import "https://example.test/x";</style></svg>','<svg><path style="fill:url(https://example.test/x)"/></svg>','<svg><a href="javascript:alert(1)">x</a></svg>','<svg><g id="a"/><g id="a"/></svg>','<svg id="diagram" viewBox="0 0 10 10"><style>#diagram+body{color:red}</style></svg>'])assert.throws(()=>sanitizeMermaidSvg(svg));
});
test('preparation refuses active context and external resources before any legacy engine loads',async()=>{
 const {prepareArchivedMermaid}=await import('../src/migration/conversion/compiled/mermaid-prepare.ts');
 const plan={id:'m',code:'flowchart LR; A-->B'};
 for(const html of ['<script>globalThis.untrusted=true</script>','<img src="https://example.test/a">','<svg onload="run()"></svg>','<div style="background:url(https://example.test/a)"></div>']){
  await assert.rejects(prepareArchivedMermaid('/nonexistent-legacy-root',{html,css:'',plans:[plan]}),/Active|External/);
 }
 await assert.rejects(prepareArchivedMermaid('/nonexistent-legacy-root',{html:'',css:'@import "https://example.test/a";',plans:[plan]}),/External/);
});
