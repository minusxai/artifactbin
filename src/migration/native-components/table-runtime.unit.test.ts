import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_TABLE_RUNTIME} from './table-runtime.ts';

test('custom cells retain typed row identity across reorder and virtualization while disposing inactive scopes',()=>{
 type Scope={active:boolean;cleanups:Set<()=>void>};
 class Node {style={display:''};children:Node[]=[];parent:Node|null=null;get firstChild():Node|null{return this.children[0]??null;}append(...nodes:Node[]){for(const node of nodes){node.parent?.remove(node);node.parent=this;this.children.push(node);}}remove(node:Node){this.children=this.children.filter(child=>child!==node);node.parent=null;}replaceChildren(...nodes:Node[]){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}contains(node:Node):boolean{return node===this||this.children.some(child=>child.contains(node));}}
 let notify=()=>{};class Observer{constructor(fn:()=>void){notify=fn;}observe(){}disconnect(){}}
 const host=Object.assign(new Node(),{ownerDocument:{createElement:()=>new Node(),defaultView:{MutationObserver:Observer}},cellRenderers:{} as Record<string,(cell:any,existing:Node)=>void>,data:null,columnIdentities:null,columns:null,rowKey:''});
 const root:Scope={active:true,cleanups:new Set()},dispose=(scope:Scope)=>{if(!scope.active)return;scope.active=false;for(const fn of scope.cleanups)fn();scope.cleanups.clear();};
 const seen:{node:Node;row:any;context:any}[]=[],cloned:any[]=[];
 const create=new Function('return ('+NATIVE_TABLE_RUNTIME+')')();
 const table=create(host,{owner:'table-owner',rowKey:'id',columns:[{afId:'column-af',domId:'column-dom',spec:{col:'action',title:''},template:{templateId:'action-template',templateIds:['action-af'],domIds:[{domId:'cancel-dom',templateAfId:'action-af'}]}}]}, {clone:(_id:string,context:any)=>{cloned.push(context);return [new Node()];},render:(node:Node,row:any,context:any)=>seen.push({node,row,context}),cellScope:(parent:Scope,identity:{owner:string;rowKey:string|number;column:string})=>{assert.equal(identity.owner,'table-owner');assert.equal(identity.column,'action');const scope:Scope={active:true,cleanups:new Set()};parent.cleanups.add(()=>dispose(scope));return scope;},disposeScope:dispose});
 table.update({rows:[]},root);assert.deepEqual(host.columnIdentities,{action:{afId:'column-af',id:'column-dom'}});
 const a=new Node(),b=new Node();host.append(a,b);const renderer=host.cellRenderers.action!;
 renderer({row:{id:7,value:'first'},key:7,column:'action'},a);renderer({row:{id:'7',value:'other'},key:'7',column:'action'},b);
 assert.notEqual(cloned[0].ids['action-af'],cloned[1].ids['action-af']);assert.equal(cloned[0].ids['action-af'],'mx-instance-'+encodeURIComponent(JSON.stringify([['table','table-owner','number',7,'action'],'action-af'])));
 const original=a.firstChild!,oldScope=seen[0]!.context.scope;host.remove(a);notify();assert.equal(oldScope.active,false);
 const replacement=new Node();host.append(replacement);renderer({row:{id:7,value:'updated'},key:7,column:'action'},replacement);
 assert.equal(replacement.firstChild,original);assert.equal(cloned.length,2);assert.equal(seen.at(-1)!.row.value,'updated');assert.equal(seen.at(-1)!.context.scope.active,true);assert.notEqual(seen.at(-1)!.context.scope,oldScope);
 assert.throws(()=>renderer({row:{},key:null,column:'action'},replacement),/stable table row key/);
 dispose(root);assert.equal(seen.at(-1)!.context.scope.active,false);table.update({rows:[]},{active:true,cleanups:new Set()});renderer({row:{id:7},key:7,column:'action'},replacement);assert.equal(replacement.firstChild,original);
});
