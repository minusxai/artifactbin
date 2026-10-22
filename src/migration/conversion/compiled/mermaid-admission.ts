import type {CompiledMermaidPlan} from './mermaid-contracts.ts';
/** Frozen Mermaid static-flowchart surface. Unsupported expressions remain explicit refusals. */
export function admitMermaid(attrs: Readonly<Record<string,unknown>>, hasChildren=false):CompiledMermaidPlan {
 const allowed=new Set(['id','code','title','className','data-af-id','data-af-comment']);
 if(hasChildren||Object.keys(attrs).some(k=>!allowed.has(k)))throw Error('Unsupported Mermaid props');
 if(typeof attrs.id!=='string'||!attrs.id||attrs.id.length>256)throw Error('Mermaid requires stable identity');
 const code=attrs.code;
 if(typeof code!=='string'||!code.trim()||code.length>20000||!/^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/.test(code))throw Error('Unsupported Mermaid code');
 if(/^\s*---(?:\s|$)/.test(code)||/%%\s*\{|\bclick\s|\b(?:img|image|icon)\s*:|<\/?[A-Za-z]|\burl\s*\(/i.test(code))throw Error('Unsupported Mermaid resource/configuration');
 for(const key of ['title','className'])if(attrs[key]!==undefined&&(typeof attrs[key]!=='string'||attrs[key].length>4096))throw Error('Invalid Mermaid text');
 return {id:attrs.id,code,...(attrs.title===undefined?{}:{title:attrs.title as string}),...(attrs.className===undefined?{}:{className:attrs.className as string})};
}
