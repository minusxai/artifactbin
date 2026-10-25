import {expect,it} from 'vitest';
import {transformSync} from 'esbuild';
import {directVisualSource} from '../fixtures/direct-visual-libraries.mjs';
it('emits executable native module source for the same hosted, preview and offline fixture',()=>{
 const html=directVisualSource({mermaid:'/libraries/mermaid-12.0.0/index.js',deck:'/libraries/deck-gl-9.4.0/index.js'});
 const modules=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(match=>match[1]);expect(modules).toHaveLength(2);
 for(const module of modules)expect(()=>transformSync(module,{loader:'js',format:'esm',target:'es2022'})).not.toThrow();
 expect(modules.flatMap(module=>[...module.matchAll(/from\s+["']([^"']+)["']/g)].map(match=>match[1]))).toEqual(['/libraries/mermaid-12.0.0/index.js','/libraries/deck-gl-9.4.0/index.js','/libraries/deck-gl-9.4.0/index.js']);
 expect(html).not.toMatch(/af-mermaid|af-deck-gl|https?:\/\//);
});
