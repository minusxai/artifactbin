import test from 'node:test';import assert from 'node:assert/strict';
import{classifyStaticMermaidSyntax}from'../src/migration/conversion/compiled/mermaid-syntax.ts';
import{admitMermaid}from'../src/migration/conversion/compiled/mermaid-admission.ts';
test('static Mermaid label prose and line breaks retain original code without granting source capabilities',()=>{
 for(const code of ['flowchart LR; A[Image: text] --> B[Done]','graph TD; A -->|Click here| B','flowchart LR; A[First<br>second] --> B[Done]','flowchart LR; A["First<br/>second"] --> B[Done]','sequenceDiagram\nA->>B: Saved message']){
  assert.ok(classifyStaticMermaidSyntax(code));assert.equal(admitMermaid({id:'m',code}).code,code);
 }
 assert.deepEqual(classifyStaticMermaidSyntax('flowchart LR; A[First<br/>second] --> B'),{kind:'flowchart',literalLabelBreaks:1});
});
test('label syntax cannot conceal active links, resource shapes, arbitrary HTML or malformed scope',()=>{
 for(const code of ['flowchart LR; A-->B; click A callback','flowchart LR; A-->B\nclick A "https://example.test"','flowchart LR; A[Text] --> B; click A href "https://example.test"','flowchart LR; A@{img:"https://example.test/a"}','flowchart LR; A[<img src="x">]','flowchart LR; A[<a href="https://example.test">X</a>]','flowchart LR; A[Text<br onload="run()">]','flowchart LR; A[Text<br><script>x</script>]','flowchart LR; A[unterminated','flowchart LR; A-->B\nstyle A fill:url(https://example.test/a)','sequenceDiagram\nlink A: Link @ https://example.test','sequenceDiagram\nlinks A: {"Link":"https://example.test"}','%%{init:{}}%%\nflowchart LR; A-->B','classDiagram; A-->B'])assert.throws(()=>classifyStaticMermaidSyntax(code),code);
});

test('sequence renderer symbols remain inert local SVG definitions',async()=>{
 const {sanitizeMermaidSvg}=await import('../src/migration/conversion/compiled/mermaid-svg.ts');
 assert.ok(sanitizeMermaidSvg('<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><defs><symbol id="actor" name="actor" data-type="actor"><rect width="10" height="10"/></symbol></defs><use href="#actor"/></svg>').svg);
 assert.throws(()=>sanitizeMermaidSvg('<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><symbol id="actor"><image href="https://example.test/x"/></symbol></svg>'));
});

test('SVG XML stylesheet entities preserve local child selectors without opening an HTML parser escape',async()=>{
 const {sanitizeMermaidSvg}=await import('../src/migration/conversion/compiled/mermaid-svg.ts');
 const svg='<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>#seq text.actor&gt;tspan{fill:red}</style><text class="actor"><tspan>Actor</tspan></text></svg>';
 assert.match(sanitizeMermaidSvg(svg).svg,/#seq text.actor>tspan/);
 for(const css of ['#seq text{content:"&lt;/style&gt;&lt;image href=x&gt;"}','#seq text{fill:url(&quot;https://example.test/a&quot;)}','#seq text{content:"&unknown;"}'])assert.throws(()=>sanitizeMermaidSvg('<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>'+css+'</style></svg>'));
});

test('SVG CSS loading functions, inherited paint and escaped grammar fail closed',async()=>{const {sanitizeMermaidSvg}=await import('../src/migration/conversion/compiled/mermaid-svg.ts');for(const declaration of ['background-image:image-set("https://example.invalid/x" 1x)','background:-webkit-image-set("https://example.invalid/x" 1x)','fill:u\\72l("https://example.invalid/x")','fill:var(--outside-paint)','fill:inherit','stroke:context-stroke','background:attr(data-src url)','all:inherit','f\\69ll:red'])assert.throws(()=>sanitizeMermaidSvg('<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>#seq{'+declaration+'}</style></svg>'),declaration);
const svg='<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>@keyframes move{from{opacity:0}to{opacity:1}}#seq{animation:move 1s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.2))}</style></svg>';const safe=sanitizeMermaidSvg(svg).svg;assert.equal(sanitizeMermaidSvg(safe).svg,safe);});
