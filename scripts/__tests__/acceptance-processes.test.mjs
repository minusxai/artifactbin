import {it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {runAcceptanceProcesses} from '../../services/cli/scripts/acceptance-processes.mjs';
it('starts independent proofs together and waits for all verdicts before reporting failure',async()=>{
 const children=[];
 const pending=runAcceptanceProcesses(['preview','local','terminal'].map(label=>({label,command:'node',args:[label]})),{spawnProcess:()=>{const child=new EventEmitter();child.kill=()=>{};children.push(child);return child;}});
 expect(children).toHaveLength(3);
 let settled=false;pending.catch(()=>{settled=true;});
 children[0].emit('exit',1);children[1].emit('exit',0);
 await Promise.resolve();expect(settled).toBe(false);
 children[2].emit('exit',2);
 await expect(pending).rejects.toMatchObject({errors:[expect.objectContaining({message:'preview exited 1'}),expect.objectContaining({message:'terminal exited 2'})]});
});
it('accepts successful proofs and rejects launch errors',async()=>{
 const spawnProcess=()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;};
 await expect(runAcceptanceProcesses([{label:'native',command:'node',args:[]}],{spawnProcess})).resolves.toBeUndefined();
 await expect(runAcceptanceProcesses([{label:'native',command:'node',args:[]}],{spawnProcess:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('missing runtime')));return child;}})).rejects.toMatchObject({errors:[expect.objectContaining({message:'missing runtime'})]});
});
