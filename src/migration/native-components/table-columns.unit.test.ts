import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeTableTarget} from './table-columns.ts';
import type {RetainedJsxNode} from './analyze-contracts.ts';
const attrs=(values:Record<string,string>)=>Object.entries(values).map(([name,json])=>({name,start:0,end:1,value:{static:true as const,json}}));
function fixture(){
 const action:RetainedJsxNode={type:'element',graphKey:'action',tag:'Button',isComponent:true,selfClosing:true,start:0,end:1,attributes:attrs({id:'cancel',run:'$cancel'}),children:[]};
 const node:RetainedJsxNode={type:'element',graphKey:'table',tag:'DataTable',isComponent:true,selfClosing:false,start:0,end:1,attributes:attrs({id:'owner',data:'$rows',rowKey:'id'}),children:[{type:'element',graphKey:'column',tag:'Column',isComponent:true,selfClosing:false,start:0,end:1,attributes:attrs({id:'actions',col:'action',title:''}),children:[action]}]};
 return {node,bindings:[{sourceNode:'table',afId:'table-id',authoredDomId:'owner'},{sourceNode:'column',afId:'column-id',authoredDomId:'actions'},{sourceNode:'action',afId:'action-id',authoredDomId:'cancel'}]};
}
test('column conversion preserves header and exact action cell identity plans',()=>{
 const {node,bindings}=fixture(),plan=nativeTableTarget(node,bindings)!;
 assert.equal(plan.owner,'owner');assert.equal(plan.rowKey,'id');assert.deepEqual(plan.columns[0]!.spec,{col:'action',title:''});assert.equal(plan.columns[0]!.domId,'actions');assert.deepEqual(plan.columns[0]!.template!.templateIds,['action-id']);
});
test('column conversion refuses inferred keys, duplicate columns, unproved descendants and unsupported attributes',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{if(f.node.type==='element')f.node.attributes=f.node.attributes.filter(a=>a.name!=='rowKey');},(f:ReturnType<typeof fixture>)=>{if(f.node.type==='element')f.node.children.push(f.node.children[0]!);},(f:ReturnType<typeof fixture>)=>{f.bindings.pop();},(f:ReturnType<typeof fixture>)=>{if(f.node.type==='element'&&f.node.children[0]!.type==='element')f.node.children[0]!.attributes.push(...attrs({invented:'yes'}));}]){const f=fixture();mutate(f);assert.throws(()=>nativeTableTarget(f.node,f.bindings));}
});
