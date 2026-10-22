import {controlLiteral} from './data-controls.ts';
import type {CompiledSlideDeck} from './slide-deck-contracts.ts';
/** Frozen static kit only forwards DOM props; executable and dynamic props are never admitted. */
export function admitSlideDeckComponent(tag:string,attrs:Readonly<Record<string,unknown>>):void {
 if(!['SlideDeck','Slide'].includes(tag))throw Error('Unknown slide component');
 for(const [name,value] of Object.entries(attrs)){
  if(name==='style'){
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!/^[-a-zA-Z]+$/.test(k)||!['string','number'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)))throw Error('Static slide style required');
  }else if(!['id','className','title'].includes(name)||typeof value!=='string'||value.length>4096)throw Error('Unsupported slide prop');
 }
}
/** Discover exactly the static slides seen by the archived chrome. Conditional
 * and repeated slides cannot honestly use its static rail and are refused. */
export function readSlideDeckPlan(tree:unknown):CompiledSlideDeck|undefined {
 const slides:{id?:string;title:string}[]=[];
 const text=(n:any):string=>n?.type==='JSXText'?n.value:n?.type==='JSXExpressionContainer'&&n.expression?.type==='Literal'&&typeof n.expression.value==='string'?n.expression.value:(n?.children??[]).map(text).join('');
 const heading=(n:any):string|undefined=>{
  if(n?.type==='JSXElement'&&/^h[1-6]$/.test(n.openingElement.name.name)){const value=text(n).trim();if(value)return value;}
  for(const c of n?.children??[]){const value=heading(c);if(value)return value;}
 };
 const visit=(n:any,dynamic=false,inSlide=false,depth=0):void=>{
  if(!n||typeof n!=='object')return;
  if(depth>128)throw Error('Slide structure limit');
  if(n.type==='JSXElement'){
   const tag=n.openingElement.name.name;
   if(['SlideDeck','Slide'].includes(tag)){
    if(dynamic||inSlide)throw Error('Static nonnested slides required');
    const attrs:Record<string,unknown>=Object.create(null);
    for(const a of n.openingElement.attributes){if(a.type!=='JSXAttribute'||Object.hasOwn(attrs,a.name?.name))throw Error('Slide attribute shape');attrs[a.name.name]=controlLiteral(a.value);}
    admitSlideDeckComponent(tag,attrs);
    if(tag==='Slide'){
     if(slides.length>=4096)throw Error('Slide count limit');
     slides.push({...typeof attrs.id==='string'?{id:attrs.id}:{},title:(typeof attrs.title==='string'?attrs.title.trim():'')||heading(n)||`Slide ${slides.length+1}`});
    }
   }
   for(const c of n.children)visit(c,dynamic||tag==='For',inSlide||tag==='Slide',depth+1);
  }else if(n.type==='JSXFragment')for(const c of n.children)visit(c,dynamic,inSlide,depth+1);
  else if(n.type==='JSXExpressionContainer')visit(n.expression,true,inSlide,depth+1);
  else if(n.type==='ConditionalExpression'){visit(n.consequent,true,inSlide,depth+1);visit(n.alternate,true,inSlide,depth+1);}
  else if(n.type==='LogicalExpression')visit(n.right,true,inSlide,depth+1);
 };
 visit(tree);return slides.length?{slides}:undefined;
}
