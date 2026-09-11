import {expect,it} from 'vitest';
import {planAccess,needsStartDocument,tokenFromPaste} from '../lib/tasks';
import {TaskSchema} from '../lib/contracts';
const base='http://127.0.0.1:5220';
const task=TaskSchema.parse({id:'publish',brief:'Publish the report.',handoff:'token',checks:['published']});
const start={id:'abc123',prompt:'Use this document using this token: mx_paste'};
it('saves supplied credentials once and uses them for seeding',()=>{
 const result=planAccess({task:{...task,seed:'<p>Seed</p>'},base,start,credential:{token:'mx_account'}});
 expect(result.connectionToken).toBe('mx_account');expect(result.seed).toEqual({id:'abc123',token:'mx_account',markup:'<p>Seed</p>'});
});
it('saves the explicitly handed-off paste credential for the CLI',()=>{
 expect(planAccess({task,base,start,credential:null}).connectionToken).toBe('mx_paste');
 expect(()=>tokenFromPaste('No credential')).toThrow('start paste carries no token');
});
it('a no-credential task gets no document, connection or seed even when the driver has an account',()=>{
 const none={...task,handoff:'none' as const};expect(needsStartDocument(none)).toBe(false);
 expect(planAccess({task:none,base,start:null,credential:{token:'mx_account'}})).toEqual({access:{kind:'none',base},connectionToken:null,seed:null});
 expect(()=>planAccess({task:none,base,start,credential:null})).toThrow('must not be given a start document');
 expect(()=>planAccess({task,base,start:null,credential:null})).toThrow('needs a start document');
});
