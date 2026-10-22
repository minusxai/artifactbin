import type {AdmittedDialogMutationForm} from "./dialog-form-contracts.ts";
/** Presentation does not grant mutation authority: source traversal must resolve this registered name. */
export function admitDialogMutationForm(attrs:Record<string,unknown>,ancestors:readonly string[],rowTable?:string):AdmittedDialogMutationForm|null {
 if(attrs.run===undefined){if(attrs.args!==undefined)throw Error('Dialog arguments require a registered mutation');return null;}
 if(!ancestors.includes('Dialog')||ancestors.includes('form')||ancestors.includes('DialogContent')||rowTable||typeof attrs.run!=='string'||!/^\$[A-Za-z][A-Za-z0-9_]{0,127}$/.test(attrs.run))throw Error('Unsupported dialog mutation form');
 const references:string[]=[];let requiresViewer=false;
 if(attrs.args!==undefined){
  const args=attrs.args;
  if(!args||typeof args!=='object'||Array.isArray(args)||![Object.prototype,null].includes(Object.getPrototypeOf(args))||Reflect.ownKeys(args).length>256)throw Error('Invalid dialog mutation arguments');
  for(const key of Reflect.ownKeys(args)){
   const d=Object.getOwnPropertyDescriptor(args,key)!;
   if(typeof key!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)||['__proto__','constructor','prototype'].includes(key)||!('value'in d))throw Error('Invalid dialog mutation arguments');
   const v=d.value;
   if(!(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.length<=65536))throw Error('Invalid dialog mutation argument');
   if(typeof v==='string'&&v.startsWith('$')){
    if(v==='$_me.id')requiresViewer=true;
    else if(/^\$[A-Za-z][A-Za-z0-9_]{0,127}$/.test(v))references.push(v.slice(1));
    else throw Error('Unsupported dialog argument binding');
   }
  }
 }
 return {name:attrs.run.slice(1),args:attrs.args as AdmittedDialogMutationForm['args'],references,requiresViewer};
}
/** Native forms and dynamically authored components cannot silently introduce nested forms. */
export function assertDialogFormChildren(node:any):void {
 const safeKit=new Set(['Button','Input','Textarea','Select','Segmented','Switch','Slider','Number','User','DialogClose','DialogTitle','DialogDescription','DialogFooter','DialogHeader','Label','Avatar','AvatarFallback','Badge','Separator']);
 const walk=(n:any)=>{
  if(!n||typeof n!=='object')return;
  if(n.type==='JSXElement'){
   const tag=n.openingElement.name.name;
   if(typeof tag!=='string'||tag==='form'||tag==='DialogContent'||tag==='Dialog'||/^[A-Z]/.test(tag)&&!safeKit.has(tag))throw Error('Unsupported nested mutation form content');
  }
  for(const[k,v]of Object.entries(n))if(!['start','end'].includes(k)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 };
 node.children.forEach(walk);
}
