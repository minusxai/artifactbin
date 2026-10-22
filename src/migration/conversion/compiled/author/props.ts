import type {AdmitAuthorProps, AuthorPropJson, AdmittedAuthorMountProps} from './prop-contracts.ts';
const forbidden=new Set(['constructor','prototype','__proto__']);
const binding=(value:unknown):string|null=>typeof value==='string'&&/^\$[A-Za-z][A-Za-z0-9_]*$/.test(value)&&!forbidden.has(value.slice(1))?value.slice(1):null;
/** Decode the same JSON/signal ABI as archived mountParts, with explicit bounds.
 * Object or array contents are JSON, not recursively interpreted bindings. */
export const admitAuthorProps:AdmitAuthorProps=(attributes)=>{
 if(!Array.isArray(attributes)||attributes.length>256)throw Error('Author prop limit');
 let nodes=0;
 const json=(node:any,depth=0):unknown=>{
  if(!node||depth>32||++nodes>20000)throw Error('Author prop complexity');
  if(node.type==='Literal'&&(node.value===null||typeof node.value==='string'||typeof node.value==='boolean'||(typeof node.value==='number'&&Number.isFinite(node.value))))return node.value;
  if(node.type==='TemplateLiteral'&&!node.expressions.length)return node.quasis[0].value.cooked;
  if(node.type==='UnaryExpression'&&['-','+'].includes(node.operator)&&node.argument?.type==='Literal'&&typeof node.argument.value==='number'&&Number.isFinite(node.argument.value))return node.operator==='-'?-node.argument.value:node.argument.value;
  if(node.type==='ArrayExpression')return node.elements.map((value:any)=>json(value,depth+1));
  if(node.type==='ObjectExpression'){
   const result:Record<string,unknown>=Object.create(null);
   for(const p of node.properties){
    const key=p.key?.type==='Identifier'?p.key.name:p.key?.type==='Literal'?p.key.value:null;
    if(p.type!=='Property'||p.computed||p.method||p.shorthand||p.kind!=='init'||typeof key!=='string'||forbidden.has(key)||Object.hasOwn(result,key))throw Error('Author prop object');
    result[key]=json(p.value,depth+1);
   }
   return result;
  }
  throw Error('Unsupported author prop expression');
 };
 const names=new Set<string>(),bindings:Record<string,string>=Object.create(null),props:Record<string,AuthorPropJson>=Object.create(null);let bytes=0;let identity:string|undefined,className:string|undefined;
 for(const attribute of attributes){
  const name=attribute.name?.type==='JSXIdentifier'?attribute.name.name:null;
  if(attribute.type!=='JSXAttribute'||typeof name!=='string'||forbidden.has(name)||names.has(name)||/^data-(?:mx|migration-author)-/.test(name))throw Error('Unsupported author prop name');
  names.add(name);
  const expression=attribute.value?.type==='JSXExpressionContainer'?attribute.value.expression:attribute.value;
  const signal=expression?.type==='Identifier'?binding(expression.name):null;
  const value=signal?null:attribute.value===null?true:json(expression);
  const ref=signal??binding(value);
  if(['id','class','className'].includes(name)){
   if(ref||typeof value!=='string')throw Error('Author mount DOM attribute must be text');
   if(name==='id') identity=value; else className=value;
  }else if(ref)bindings[name]=ref; else props[name]=value as AuthorPropJson;
  bytes+=Buffer.byteLength(name)+Buffer.byteLength(JSON.stringify(value));
  if(bytes>256*1024)throw Error('Author prop size');
 }
 return {props,bindings,...(identity===undefined?{}:{identity}),...(className===undefined?{}:{className})};
};

/** Key order has no JSON meaning; arrays, scalar types and exact bindings do. */
export function reconcileAuthorProps(expected:AdmittedAuthorMountProps,props:unknown,bindings:unknown):boolean {
 const canonical=(value:unknown,depth=0,budget={nodes:0}):string=>{
  if(++budget.nodes>25000||depth>32)throw Error('Author prop limit');
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1,budget)).join(',')+']';
  if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
   const keys=Object.keys(value).sort();if(keys.some(k=>forbidden.has(k)))throw Error('Author prop key');
   return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k],depth+1,budget)).join(',')+'}';
  }
  throw Error('Author prop JSON');
 };
 try{return canonical(expected.props)===canonical(props)&&canonical(expected.bindings)===canonical(bindings);}catch{return false;}
}
