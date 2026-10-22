import {parse,walk,clone,generate} from 'css-tree';
import type {IsolateArchivedThemeVariables} from './legacy-theme-contracts.ts';
/** Keep archived inherited theme variables on the existing story root. Platform
 * :root variables may change with the viewer design system; source-owned local
 * declarations must win inheritance while retaining their own original cascade. */
export const isolateArchivedThemeVariables:IsolateArchivedThemeVariables=(css)=>{
 const tree=parse(css),attribute=(parse('[data-mx-inline-story]',{context:'selector'}) as any).children.first;
 let changed=false;
 walk(tree,{visit:'Rule',enter(node:any,item:any,list:any){
  if(!list||node.prelude?.type!=='SelectorList')return;
  const selectors:any[]=[];
  for(const selector of node.prelude.children){
   let roots=0,valid=true;
   walk(selector,(part:any)=>{
    if(part.type==='PseudoClassSelector'){
     if(part.name==='root')roots++;
     else if(!['where','is','not'].includes(part.name))valid=false;
    }
    if(part.type==='Combinator'||part.type==='TypeSelector'||part.type==='PseudoElementSelector')valid=false;
   });
   if(!roots||!valid)continue;
   const scoped=clone(selector);walk(scoped,{visit:'PseudoClassSelector',enter(part:any,partItem:any,partList:any){if(part.name==='root')partList.replace(partItem,partList.createItem(clone(attribute)));}});selectors.push(scoped);
  }
  const defaultFont = generate(node.prelude)==='html,:host'
   ? [...node.block.children].filter((part:any)=>part.type==='Declaration'&&part.property==='font-family'&&generate(part.value).startsWith('var(--default-font-family,')) : [];
  if(defaultFont.length){
   const floor=clone(node);floor.prelude=parse(':where([data-mx-inline-story])',{context:'selectorList'});floor.block.children.clear();for(const declaration of defaultFont)floor.block.children.appendData(clone(declaration));list.insertData(floor,item.next);changed=true;
  }
  if(!selectors.length)return;
  const properties=[...node.block.children].filter((part:any)=>part.type==='Declaration'&&(part.property.startsWith('--')||part.property==='font-family'));
  if(!properties.length)return;
  const copy=clone(node);copy.prelude.children.clear();for(const selector of selectors)copy.prelude.children.appendData(selector);copy.block.children.clear();for(const property of properties)copy.block.children.appendData(clone(property));
  list.insertData(copy,item.next);changed=true;
 }});
 return changed?generate(tree):css;
};
