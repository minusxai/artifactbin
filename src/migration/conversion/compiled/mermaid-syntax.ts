import type {StaticMermaidSyntax} from './mermaid-syntax-contracts.ts';
/** Conservative lexical recognition of inert flowchart labels, not a second renderer.
 * The original source goes unchanged to the pinned engine, then strict SVG sanitization.
 * Only label scopes can contain prose resembling commands; directives outside remain refused. */
export function classifyStaticMermaidSyntax(code:string):StaticMermaidSyntax {
 if(typeof code!=='string'||!code.trim()||code.length>20000)throw Error('Unsupported Mermaid code');
 const kind=/^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/.test(code)?'flowchart':/^\s*sequenceDiagram\b/.test(code)?'sequence':null;
 if(!kind)throw Error('Unsupported Mermaid code');
 if(/^\s*---(?:\s|$)/.test(code)||/%%\s*\{|@\s*\{|\burl\s*\(/i.test(code))throw Error('Unsupported Mermaid resource/configuration');
 let outside='',literalLabelBreaks=0,quote='',pipe=false;
 const stack:string[]=[];
 for(let i=0;i<code.length;i++){
  const c=code[i]!;const inLabel=pipe||stack.length>0;
  if(c==='<'&&/^<\/?[A-Za-z]/.test(code.slice(i))){
   const match=/^<br\s*\/?\s*>/i.exec(code.slice(i));
   if(!inLabel||!match)throw Error('Unsupported Mermaid label HTML');
   literalLabelBreaks++;i+=match[0].length-1;continue;
  }
  if(inLabel){
   if(quote){if(c===quote&&code[i-1]!=='\\')quote='';continue;}
   if(c==='"'){quote=c;continue;}
   if(pipe){if(c==='|')pipe=false;continue;}
   if(['[','(','{'].includes(c)){stack.push(c);continue;}
   if([']',')','}'].includes(c)){
    const expected:Record<string,string>={']':'[',')':'(','}':'{'};
    if(stack.pop()!==expected[c])throw Error('Malformed Mermaid label');
   }
   continue;
  }
  if(kind==='flowchart'){
   // A node identity immediately precedes its shape. Attribute objects (@{…})
   // are refused above, so their resource declarations cannot masquerade as labels.
   if(['[','(','{'].includes(c)&&/[A-Za-z0-9_]$/.test(code.slice(0,i))){stack.push(c);continue;}
   // Edge label delimiters occur immediately after an edge operator.
   if(c==='|'&&/(?:-->|---|==>|-\.->)\s*$/.test(code.slice(0,i))){pipe=true;continue;}
  }
  outside+=c;
 }
 if(stack.length||pipe||quote)throw Error('Malformed Mermaid label');
 if(/\bclick\s|\b(?:img|image|icon)\s*:/i.test(outside)||kind==='sequence'&&/^\s*links?\s/im.test(outside))throw Error('Unsupported Mermaid resource/configuration');
 return {kind,literalLabelBreaks};
}
