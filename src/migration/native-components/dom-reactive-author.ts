import {parse} from 'acorn';
import {nativeOrdinaryDomUnsupportedCapability} from './ordinary-dom-author-profile-selection.ts';
import type {NativeDomReactiveSource} from './dom-reactive-author-contracts.ts';
type Node={type:string;start:number;end:number;[key:string]:unknown};
/** Parse only the reviewed ordinary DOM/Solid surface. Profile admission independently binds exact source bytes. */
export function adaptNativeDomReactiveSource(source:string,identifier:string):NativeDomReactiveSource {
 if(!/^[_A-Za-z][_A-Za-z0-9]*$/.test(identifier))throw Error('Invalid DOM reactive identifier');
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}) as unknown as Node;
 const edits:Array<{start:number;end:number;text:string}>=[],imports=new Map<string,string>(),namedSignals:string[]=[];
 for(const item of tree.body as Node[]){
  if(item.type!=='ImportDeclaration')continue;
  if((item.source as Node).value!=='solid-js')throw Error('Unsupported DOM reactive import');
  for(const spec of item.specifiers as Node[]){const imported=(spec.imported as Node)?.name,local=(spec.local as Node)?.name;if(spec.type!=='ImportSpecifier'||!['createSignal','createEffect','onMount','onCleanup'].includes(String(imported))||typeof local!=='string'||imports.has(local)||local===identifier)throw Error('Unsupported DOM reactive capability');imports.set(local,String(imported));}
  edits.push({start:item.start,end:item.end,text:''});
 }
 if(!imports.size)throw Error('No DOM reactive capability');
 const visit=(node:Node,parent?:Node,functions=0):void=>{
  if(node.type==='ImportDeclaration')return;
  if(['ImportExpression','ExportNamedDeclaration','ExportDefaultDeclaration','ExportAllDeclaration'].includes(node.type))throw Error('Unsupported DOM reactive module');
  if(node.type==='Identifier'&&node.name===identifier)throw Error('DOM reactive identifier collision');
  if(node.type==='Identifier'&&imports.has(String(node.name))){
   if(parent?.type!=='CallExpression'||parent.callee!==node||parent.optional)throw Error('DOM reactive capability escape');
   const capability=imports.get(String(node.name))!,args=parent.arguments as Node[];
   if(args.some(arg=>arg.type==='SpreadElement'))throw Error('Unsupported DOM reactive arguments');
   if(capability==='createSignal'){
    const options=args[1],props=options?.properties as Node[]|undefined;
    if(functions||args.length!==2||options?.type!=='ObjectExpression'||props?.length!==1||props[0]?.type!=='Property'||props[0]?.computed||(props[0]?.key as Node)?.name!=='name'||(props[0]?.value as Node)?.type!=='Literal'||typeof (props[0]?.value as Node)?.value!=='string')throw Error('DOM reactive application signal must be named at module level');
    const name=String((props[0]!.value as Node).value);if(!/^[_A-Za-z][_A-Za-z0-9]*$/.test(name)||namedSignals.includes(name))throw Error('Invalid or duplicate DOM reactive name');namedSignals.push(name);
   }else if(args.length!==1)throw Error('Unsupported DOM reactive callback');
   edits.push({start:node.start,end:node.end,text:identifier+'.'+capability});
  }
  if(node.type==='MemberExpression'&&((node.property as Node)?.name==='addEventListener'||(node.property as Node)?.value==='addEventListener')){
   if(node.computed||node.optional||parent?.type!=='CallExpression'||parent.callee!==node||parent.optional)throw Error('Unsupported DOM reactive listener');
   const args=parent.arguments as Node[];if(args.length<2||args.length>3||args.some(arg=>arg.type==='SpreadElement')||args[0]?.type!=='Literal'||typeof args[0].value!=='string')throw Error('Unsupported DOM reactive listener');
   const object=node.object as Node;edits.push({start:node.start,end:node.end,text:identifier+'.listen'},{start:args[0]!.start,end:args[0]!.start,text:source.slice(object.start,object.end)+','});
  }
  const nested=functions+(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)?1:0);
  for(const value of Object.values(node)){if(Array.isArray(value))for(const child of value){if(child&&typeof child==='object'&&'type' in child)visit(child as Node,node,nested);}else if(value&&typeof value==='object'&&'type' in value)visit(value as Node,node,nested);}
 };
 visit(tree);
 let transformed=source;for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))transformed=transformed.slice(0,edit.start)+edit.text+transformed.slice(edit.end);
 if(nativeOrdinaryDomUnsupportedCapability(transformed,new Set([identifier])))throw Error('Unadmitted DOM reactive browser capability');
 return {source:transformed,namedSignals,signalCount:namedSignals.length};
}

/** A named source registration becomes one JSON-valued Apollo field; no remote namespace or declared Value. */
export const NATIVE_DOM_REACTIVE_APOLLO=String.raw`function installDomReactiveApollo(client,gql,plan,onError=()=>{}){
 let active=true,running=false,sequence=0;const cells=new Map(),queue=[];
 const json=value=>{const seen=new Set();const visit=value=>{if(value===null||typeof value==='string'||typeof value==='boolean')return;if(typeof value==='number'&&Number.isFinite(value))return;if(!value||typeof value!=='object'||seen.has(value)||!Array.isArray(value)&&Object.getPrototypeOf(value)!==null&&value.constructor?.name!=='Object')throw Error('Invalid named signal JSON');seen.add(value);for(const child of Object.values(value))visit(child);seen.delete(value);};visit(value);return value;};
 const dispose=()=>{if(!active)return;active=false;queue.length=0;for(const cell of cells.values())cell.subscription?.unsubscribe();cells.clear();};
 const flush=async()=>{if(running||!active)return;running=true;try{while(queue.length&&active){const job=queue.shift();await client.updateQuery({query:job.cell.query},data=>active?{...data,[job.cell.field]:{value:job.value}}:data);if(job.cell.pending===job.sequence)job.cell.pending=0;}}catch(error){dispose();onError(error);}finally{running=false;}};
 const fields=new Map();for(const item of plan.named){if(!/^[_A-Za-z][_A-Za-z0-9]*$/.test(item.name)||!/^[_A-Za-z][_A-Za-z0-9]*$/.test(item.field)||fields.has(item.name)||[...fields.values()].includes(item.field))throw Error('Invalid named signal plan');fields.set(item.name,item.field);}
 return {open(name,initial,changed){
  if(!active||!fields.has(name)||cells.has(name))throw Error('Unavailable named signal');json(initial);
  const field=fields.get(name),cell={field,value:initial,pending:0,subscription:null,query:gql(['query NativeAuthorNamed{'+field+'}'])};cells.set(name,cell);let initialized=false,hadValue=false;
  const publish=value=>{json(value);cell.value=value;cell.pending=++sequence;queue.push({cell,value,sequence:cell.pending});void flush();};
  cell.subscription=client.watchQuery({query:cell.query}).subscribe(result=>{if(!active)return;if(result.errors?.length||!result.data){dispose();onError(Error('Named signal state unavailable'));return;}const saved=result.data[field];if(saved!==null&&saved!==undefined){if(!saved||typeof saved!=='object'||Array.isArray(saved)||!Object.hasOwn(saved,'value')){dispose();onError(Error('Invalid named signal state'));return;}try{json(saved.value);}catch(error){dispose();onError(error);return;}hadValue=true;if(!cell.pending&&!Object.is(cell.value,saved.value)){cell.value=saved.value;if(initialized)changed(cell.value);}}initialized=true;});
  if(!active){cell.subscription?.unsubscribe();throw Error('Named signal state unavailable');}if(!hadValue)publish(initial);
  return {read:()=>cell.value,write(value){if(!active)throw Error('Named signal disposed');publish(value);},close(){cell.subscription?.unsubscribe();cells.delete(name);}};
 },dispose};
}`;

/** Only private dependency/lifecycle mechanics live here; application values belong to the supplied Apollo port. */
export const NATIVE_DOM_REACTIVE_RUNTIME=String.raw`function installDomReactive(state){
 let active=true,current=null,initializing=false,flushing=false;const effects=new Set(),queued=new Set(),cells=new Set(),rootCleanups=[];
 const cleanup=effect=>{for(const remove of effect.cleanups.splice(0))remove();};
 const dispose=()=>{if(!active)return;active=false;for(const effect of effects)cleanup(effect);effects.clear();queued.clear();for(const remove of rootCleanups.splice(0))remove();for(const cell of cells)cell.close();cells.clear();state.dispose();};
 const runEffect=effect=>{if(!active)return;cleanup(effect);effect.dependencies.clear();const before=current;current=effect;try{effect.fn();}catch(error){dispose();throw error;}finally{current=before;}};
 const flush=()=>{if(!active||initializing||flushing)return;flushing=true;try{let passes=0;while(queued.size&&active){if(++passes>1000)throw Error('DOM reactive effect cycle');const pending=[...queued];queued.clear();for(const effect of pending)runEffect(effect);}}catch(error){dispose();throw error;}finally{flushing=false;}};
 const notify=cell=>{for(const effect of effects)if(effect.dependencies.has(cell))queued.add(effect);flush();};
 const api={
  createSignal(initial,options){if(!active||!options||typeof options.name!=='string'||!options.name)throw Error('Application signals must be named');const equals=options.equals===false?()=>false:options.equals??((a,b)=>a===b);if(typeof equals!=='function')throw Error('Invalid signal equality');let cell;cell=state.open(options.name,initial,()=>notify(cell));cells.add(cell);return [()=>{if(current)current.dependencies.add(cell);return cell.read();},value=>{if(!active)throw Error('DOM reactive disposed');const previous=cell.read(),next=typeof value==='function'?value(previous):value;if(!equals(previous,next)){cell.write(next);notify(cell);}return next;}];},
  createEffect(fn){if(!active||typeof fn!=='function')throw Error('Invalid DOM reactive effect');const effect={fn,dependencies:new Set(),cleanups:[]};effects.add(effect);queued.add(effect);flush();},
  onMount(fn){if(typeof fn!=='function')throw Error('Invalid DOM reactive mount');api.createEffect(()=>{const before=current;current=null;try{fn();}finally{current=before;}});},
  onCleanup(fn){if(typeof fn!=='function')throw Error('Invalid DOM reactive cleanup');(current?current.cleanups:rootCleanups).push(fn);},
  listen(host,event,listener,options){if(!active||!host?.addEventListener||typeof event!=='string')throw Error('Invalid DOM reactive listener');host.addEventListener(event,listener,options);const capture=typeof options==='boolean'?options:!!options?.capture;rootCleanups.push(()=>host.removeEventListener(event,listener,capture));},
  run(fn){if(!active||initializing)throw Error('DOM reactive module lifecycle');initializing=true;try{fn();}catch(error){dispose();throw error;}finally{initializing=false;}flush();},dispose
 };return api;
}`;
