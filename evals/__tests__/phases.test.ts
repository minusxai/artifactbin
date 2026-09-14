import {expect,it} from 'vitest';
import {phaseLogger} from '../lib/phases';
it('emits each phase immediately with elapsed and preceding phase durations',()=>{
 let now=100;
 const lines:string[]=[];
 const phase=phaseLogger(line=>lines.push(line),()=>now);
 phase('setup');
 expect(lines).toEqual(['setup elapsed=0ms previous=0ms']);
 now=250;
 phase('agent');
 now=600;
 phase('verification');
 expect(lines.slice(1)).toEqual(['agent elapsed=150ms previous=150ms','verification elapsed=500ms previous=350ms']);
});
