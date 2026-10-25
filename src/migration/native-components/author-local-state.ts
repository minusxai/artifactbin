import {parse} from 'acorn';
import type {NativeTypedAnalysis} from './analyze-contracts.ts';
import type {NativeAuthorLocalSource,NativeAuthorLocalField} from './author-local-state-contracts.ts';
type Node={type:string;start:number;end:number;[key:string]:unknown};
const name=/^[_A-Za-z][_A-Za-z0-9]*$/;
/** Parse literal page signal bindings (or explicitly selected legacy params); keep ordinary DOM source intact. No JSX/runtime compilation. */
export function adaptNativeAuthorLocalSource(source:string,analysis:NativeTypedAnalysis,identifier:string):NativeAuthorLocalSource {
 if(!name.test(identifier)||['mx','document','window','globalThis'].includes(identifier))throw Error('Invalid local port identifier');
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}) as unknown as Node;
 const edits:Array<{start:number;end:number;text?:string}>=[],fields=new Map<string,NativeAuthorLocalField>();let subscriptions=0;const signals=new Set<string>();
 for(const item of tree.body as Node[]){if(item.type!=='ImportDeclaration')continue;const imports=item.specifiers as Node[];if((item.source as Node).value!=='page'||imports.length!==1||imports[0]?.type!=='ImportSpecifier'||(imports[0].imported as Node)?.name!=='signal')throw Error('Local DOM source imports unsupported');signals.add(String((imports[0].local as Node).name));edits.push({start:item.start,end:item.end,text:''});}
 const field=(key:string)=>{const declarations=analysis.flow.values.filter(value=>value.name===key),declaration=declarations[0];if(declarations.length!==1||!declaration||declaration.kind!=='scalar'||!['string','number','boolean','date'].includes(String(declaration.type)))throw Error('Unsupported source local declaration');fields.set(key,{name:key,type:declaration.type as NativeAuthorLocalField['type'],nullable:true,default:declaration.default??null});};
 const visit=(node:Node,parent?:Node)=>{
  const object=node.object as Node|undefined,property=node.property as Node|undefined;
  if(node.type==='ImportDeclaration')return;
  if(['ImportExpression','ExportNamedDeclaration','ExportDefaultDeclaration','ExportAllDeclaration'].includes(node.type))throw Error('Local DOM source imports unsupported');
  if(node.type==='Identifier'&&node.name==='mx'&&!(parent?.type==='MemberExpression'&&parent.object===node&&!parent.computed&&(parent.property as Node)?.name==='params'))throw Error('Unsupported source runtime dependency');
  if(node.type==='Identifier'&&signals.has(String(node.name))&&!(parent?.type==='CallExpression'&&parent.callee===node))throw Error('Unsupported source signal reference');
  if(node.type==='CallExpression'&&(node.callee as Node)?.type==='Identifier'&&signals.has(String((node.callee as Node).name))){const args=node.arguments as Node[],value=args[0]?.value;if(args.length!==1||args[0]?.type!=='Literal'||typeof value!=='string'||!/^\$[_A-Za-z][_A-Za-z0-9]*$/.test(value)||parent?.type!=='VariableDeclarator'||(parent.id as Node)?.type!=='ArrayPattern'||((parent.id as Node).elements as (Node|null)[]).length!==2||((parent.id as Node).elements as (Node|null)[]).some(item=>item!==null&&item.type!=='Identifier'))throw Error('Unsupported source signal binding');field(value.slice(1));edits.push({start:node.start,end:node.end,text:identifier+'.signal('+JSON.stringify(value.slice(1))+')'});}
  if(node.type==='Identifier'&&node.name===identifier)throw Error('Local port identifier collision');
  if(node.type==='MemberExpression'&&((!node.computed&&property?.name==='mx')||(node.computed&&property?.value==='mx')))throw Error('Unsupported source runtime dependency');
  if(node.type==='MemberExpression'&&object?.type==='Identifier'&&object.name==='mx'){
   if(node.computed||property?.name!=='params'||parent?.type!=='MemberExpression'||parent.object!==node||parent.computed)throw Error('Unsupported source params access');
   edits.push({start:node.start,end:node.end});
  }
  if(node.type==='MemberExpression'&&object?.type==='MemberExpression'&&(object.object as Node)?.name==='mx'){
   if(node.computed||!['get','set','subscribe'].includes(String(property?.name))||parent?.type!=='CallExpression'||parent.callee!==node)throw Error('Unsupported source params operation');
   const args=parent.arguments as Node[];
   if(property?.name==='subscribe'){if(args.length!==1||args[0]?.type==='SpreadElement')throw Error('Unsupported source params subscription');subscriptions++;}
   else {
    if(args.length!==(property?.name==='get'?1:2)||args[0]?.type!=='Literal'||typeof args[0].value!=='string'||!name.test(args[0].value))throw Error('Local field must be declared literally');
    field(args[0].value);
   }
  }
  for(const value of Object.values(node)){if(Array.isArray(value))for(const child of value){if(child&&typeof child==='object'&&'type' in child)visit(child as Node,node);}else if(value&&typeof value==='object'&&'type' in value)visit(value as Node,node);}
 };visit(tree);
 if(!fields.size||!edits.length||subscriptions>32||signals.size&&source.includes('mx.params'))throw Error('No bounded local state dependencies');
 let transformed=source;for(const edit of edits.sort((a,b)=>b.start-a.start))transformed=transformed.slice(0,edit.start)+(edit.text??identifier)+transformed.slice(edit.end);
 return {source:transformed,plan:{fields:[...fields.values()]},runtime:signals.size?'page-signal':'legacy-mx-params'};
}
/** Ordinary author runtime with a narrow client port. Its snapshot is optimistic only for pending local writes. */
export const NATIVE_AUTHOR_LOCAL_RUNTIME=String.raw`function installAuthorLocalState(client,gql,plan,onError=()=>{}){
 const fields=new Map(plan.fields.map(field=>[field.name,field]));
 const query=gql(['query NativeAuthorLocal{'+[...fields.keys()].join(' ')+'}']);
 let disposed=false,sequence=0,running=false,subscription,confirmed={};
 const pending=new Map(),queue=[],listeners=new Set();
 const report=cause=>{try{onError(cause);}catch{}};
 const notify=()=>{if(disposed)return;for(const listener of [...listeners]){if(disposed)break;try{listener();}catch(cause){report(cause);}}};
 const valid=(field,value)=>value===null?field.nullable:typeof value===(field.type==='date'?'string':field.type)&&(field.type!=='number'||Number.isFinite(value));
 for(const field of fields.values()){if(!/^[_A-Za-z][_A-Za-z0-9]*$/.test(field.name)||!['string','number','boolean','date'].includes(field.type)||!valid(field,field.default))throw Error('Invalid author local plan');confirmed[field.name]=field.default;}
 const flush=async()=>{if(running||disposed)return;running=true;try{while(queue.length&&!disposed){const job=queue.shift();try{await client.updateQuery({query},data=>{if(disposed)return data;return {...data,[job.name]:job.value};});if(!disposed)confirmed={...confirmed,[job.name]:job.value};}catch(cause){if(!disposed)report(cause);}if(disposed)break;if(pending.get(job.name)?.sequence===job.sequence)pending.delete(job.name);notify();}}finally{running=false;}};
 const port={
  signal(name){if(!fields.has(name))throw Error('Unavailable author local field');return [()=>port.get(name),value=>port.set(name,value)];},
  get(name){if(disposed||!fields.has(name))throw Error('Unavailable author local field');return pending.has(name)?pending.get(name).value:confirmed[name];},
  set(name,value){const field=fields.get(name);if(disposed||!field||!valid(field,value))throw Error('Invalid author local value');const job={name,value,sequence:++sequence};pending.set(name,job);queue.push(job);notify();void flush();},
  subscribe(listener){if(disposed)return()=>{};listeners.add(listener);try{listener();}catch(cause){report(cause);}return()=>listeners.delete(listener);},
  dispose(){if(disposed)return;disposed=true;queue.length=0;pending.clear();listeners.clear();subscription?.unsubscribe();}
 };
 subscription=client.watchQuery({query}).subscribe(result=>{if(disposed)return;if(result.errors?.length||!result.data){if(result.errors?.length)report(Error('Author local state unavailable'));return;}const next={};for(const [name,field]of fields){if(!Object.hasOwn(result.data,name)||!valid(field,result.data[name])){report(Error('Invalid author local snapshot'));return;}next[name]=result.data[name];}confirmed=next;notify();});
 if(disposed)subscription?.unsubscribe();return port;
}`;
