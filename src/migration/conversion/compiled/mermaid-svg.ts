import {parseFragment} from 'parse5';
import {parse,walk,generate} from 'css-tree';
const tags=new Set('svg g defs symbol marker path rect polygon polyline line circle ellipse text tspan title desc style clipPath use filter fedropshadow'.split(' '));
const attributes=new Set('name id class style xmlns xmlns:xlink viewBox width height x y x1 x2 y1 y2 d cx cy r rx ry points fill fill-opacity fill-rule clip-rule stroke stroke-width stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-opacity opacity transform markerWidth markerHeight markerUnits marker-start marker-mid marker-end orient refX refY preserveAspectRatio text-anchor dominant-baseline font-family font-size font-weight font-style dy dx lengthAdjust textLength clip-path clipPathUnits role aria-roledescription aria-labelledby aria-describedby aria-hidden focusable tabindex href xlink:href alignment-baseline filter stdDeviation flood-color flood-opacity'.split(' '));
/** Trusted renderer output still crosses an active-DOM boundary: no foreign HTML,
 * loading attributes, active handlers, unscoped CSS or unresolved resource IDs. */
export function sanitizeMermaidSvg(source:string):{svg:string;width:number;height:number} {
 if(typeof source!=='string'||source.length>512000||/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('Mermaid SVG limit');
 const doc=parseFragment(source) as any;
 const roots=doc.childNodes.filter((n:any)=>n.tagName);
 if(roots.length!==1||roots[0].tagName!=='svg')throw Error('Invalid Mermaid SVG');
 const root=roots[0], ids=new Set<string>(),refs:string[]=[];
 const box=root.attrs.find((a:any)=>a.name==='viewBox')?.value.trim().split(/[\s,]+/).map(Number);
 if(!box||box.length!==4||!box.every(Number.isFinite)||box[2]<=0||box[3]<=0||box[2]>100000||box[3]>100000)throw Error('Invalid Mermaid bounds');
 const rootId=root.attrs.find((a:any)=>a.name==='id')?.value;
 const css=(text:string,inline=false)=>{
  // XMLSerializer escapes child combinators in SVG style text. Validate the
  // decoded CSS that the SVG XML parser sees, then emit inert HTML-fragment CSS.
  const decoded=text.replace(/&([^;]+);/g,(_all,entity:string)=>{
   const named:Record<string,string>={gt:'>',lt:'<',amp:'&',quot:'"',apos:"'"};
   if(Object.hasOwn(named,entity))return named[entity]!;
   const numeric=/^#(?:x([0-9a-f]+)|([0-9]+))$/i.exec(entity);if(!numeric)throw Error('Unsupported Mermaid CSS entity');
   const value=Number.parseInt(numeric[1]??numeric[2]!,numeric[1]?16:10);
   if(!Number.isInteger(value)||value<=0||value>0x10ffff||value>=0xd800&&value<=0xdfff)throw Error('Invalid Mermaid CSS entity');return String.fromCodePoint(value);
  });
  const tree=parse(decoded,{context:inline?'declarationList':'stylesheet'});
  const animations=new Map<string,string>();
  walk(tree,(node:any)=>{if(node.type==='Atrule'){if(node.name!=='keyframes'||!rootId||node.prelude?.children?.first?.type!=='Identifier')throw Error('Mermaid CSS at-rule unsupported');const name=node.prelude.children.first.name;animations.set(name,rootId+'-'+name);node.prelude.children.first.name=rootId+'-'+name;}});
  walk(tree,function(this:any,node:any){
   if(node.type==='Declaration'&&/^(animation|animation-name)$/.test(node.property))walk(node.value,(part:any)=>{if(part.type==='Identifier'&&animations.has(part.name))part.name=animations.get(part.name);});
   if(node.type==='Rule'&&this.atrule?.name!=='keyframes'){
    if(!rootId||node.prelude?.type!=='SelectorList')throw Error('Unscoped Mermaid CSS');
    node.prelude.children.forEach((selector:any)=>{const first=selector.children.first;if(first?.type!=='IdSelector'||first.name!==rootId)throw Error('Unscoped Mermaid CSS');walk(selector,(part:any)=>{if(part.type==='Combinator'&&![' ', '>'].includes(part.name))throw Error('Escaping Mermaid selector');});});
   }
   if(node.type==='Url'){if(!/^#[A-Za-z_][\w:.-]*$/.test(node.value))throw Error('External Mermaid paint');refs.push(node.value.slice(1));}
   if(node.type==='Declaration'&&/^(?:behavior|-moz-binding)$/i.test(node.property))throw Error('Active Mermaid CSS');
   if(node.type==='Function'&&/^expression$/i.test(node.name))throw Error('Active Mermaid CSS');
  });
  const rendered=generate(tree);if(rendered.includes('<'))throw Error('Active Mermaid stylesheet text');return rendered;
 };
 const visit=(node:any)=>{
  if(!node.tagName){if(node.nodeName!=='#text')throw Error('Unexpected Mermaid node');return;}
  if(node.namespaceURI!=='http://www.w3.org/2000/svg'||!tags.has(node.tagName))throw Error('Unexpected Mermaid element: '+node.tagName);
  for(const attr of node.attrs){
   const name=attr.prefix?attr.prefix+':'+attr.name:attr.name;
   if(!attributes.has(name)&&!/^data-(?:edge|id|points|look|et|type|from|to)$/.test(name))throw Error('Unexpected Mermaid attribute: '+name);
   if(name==='id'){if(!/^[A-Za-z_][\w:.-]*$/.test(attr.value)||ids.has(attr.value))throw Error('Duplicate Mermaid identity');ids.add(attr.value);}
   if(name==='href'||name==='xlink:href'){if(!/^#[A-Za-z_][\w:.-]*$/.test(attr.value))throw Error('External Mermaid link');refs.push(attr.value.slice(1));}
   if(name==='style')attr.value=css(attr.value,true);
   else if(['fill','stroke','filter','clip-path','marker-start','marker-mid','marker-end'].includes(name)||/url\s*\(/i.test(attr.value))css('paint:'+attr.value,true);
  }
  if(node.tagName==='style'){
   if(node.childNodes.some((n:any)=>n.nodeName!=='#text'))throw Error('Invalid Mermaid stylesheet');
   node.childNodes[0]={nodeName:'#text',value:css(node.childNodes.map((n:any)=>n.value).join('')),parentNode:node};node.childNodes.length=1;
  }else for(const child of node.childNodes??[])visit(child);
 };
 visit(root);
 if(refs.some(id=>!ids.has(id)))throw Error('Missing Mermaid reference');
 return {svg:source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,(_all,open,text,close)=>open+css(text)+close),width:box[2],height:box[3]};
}
