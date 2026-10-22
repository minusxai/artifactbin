import test from 'node:test';
import assert from 'node:assert/strict';
import {prototypeMermaidContext}from'../src/migration/conversion/compiled/prototype-mermaid-context.ts';
test('prototype diagram measurement retains font context while neutralizing unrelated remote resources and scripts',()=>{
 const input={html:'<div class="theme"><script>throw 1</script><img src="https://example.invalid/image.png" onload="run()"><figure id="chart">Diagram</figure></div>',css:'@import "https://example.invalid/fonts.css";@font-face{font-family:Proof;src:url("data:font/woff2;base64,AAAA")} .theme{font-family:Proof;background:url("https://example.invalid/image.png")}',plans:[{id:'chart',code:'flowchart LR; A-->B'}]};
 const result=prototypeMermaidContext(input);assert.match(result.css,/data:font\/woff2/);assert.match(result.css,/font-family:Proof/);assert.doesNotMatch(result.css,/https:|@import/);assert.doesNotMatch(result.html,/script|onload|https:/);assert.match(result.html,/id="chart"/);assert.equal(result.plans,input.plans);assert.match(input.css,/https:/);assert.match(input.html,/<script>/);
});
