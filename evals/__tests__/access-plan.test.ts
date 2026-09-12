/**
 * WHAT THE DRIVER DOES BEFORE THE TURN. Every task is authenticated by its mode and handed a document
 * the driver made as the eval account, so the plan has exactly one decision left in it: seed or not.
 */
import {expect,it} from 'vitest';
import {planAccess} from '../lib/tasks';
import {TaskSchema} from '../lib/contracts';
const base='http://127.0.0.1:5220';
const task=TaskSchema.parse({id:'publish',brief:'Publish the report.',checks:['published']});
const start={id:'abc123'};
const credential={token:'mx_account'};
it('points the agent at the document the driver made, and seeds nothing it was not asked to',()=>{
 expect(planAccess({task,base,start,credential})).toEqual({access:{base,id:'abc123'},seed:null});
});
it('seeds that same document with the task’s markup, using the driver’s own credential',()=>{
 const result=planAccess({task:{...task,seed:'<p>Seed</p>'},base,start,credential});
 expect(result.access).toEqual({base,id:'abc123'});
 expect(result.seed).toEqual({id:'abc123',token:'mx_account',markup:'<p>Seed</p>'});
});
