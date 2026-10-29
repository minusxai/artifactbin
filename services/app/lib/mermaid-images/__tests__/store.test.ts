import {afterEach,expect,it,vi} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {objectStore} from '@/lib/object-store';
import {getDb} from '@/lib/platform';
import {MERMAID_RENDER_ENGINE,mermaidImageBytes,mermaidObjectKey,onMermaidHarvestQueued,queueMermaidHarvest} from '..';
useAppHarness();
afterEach(()=>{onMermaidHarvestQueued(null);vi.restoreAllMocks();});
const harvests=async()=>(await (await getDb()).query('SELECT artifact_id,version,engine,state FROM mermaid_harvests ORDER BY artifact_id,version')).rows;
it('queues one harvest per drawable shared version and wakes the harvester, never for private or non-markup rows',async()=>{
 const wake=vi.fn();onMermaidHarvestQueued(wake);
 await queueMermaidHarvest({id:'Doc1',version:2,format:'markup',visibility:'public',source:'<Mermaid code="graph TD; A-->B" />'});
 await queueMermaidHarvest({id:'Doc1',version:2,format:'markup',visibility:'unlisted',source:'<Mermaid code="graph TD; A-->B" />'});
 await queueMermaidHarvest({id:'Doc2',version:1,format:'markup',visibility:null,source:null,document:{nodes:[{tag:'Mermaid'}]}});
 for(const row of [{id:'Doc3',version:1,format:'markup',visibility:'private',source:'<Mermaid code="x" />'},{id:'Doc4',version:1,format:'html',visibility:'public',source:'<Mermaid code="x" />'},{id:'Doc5',version:1,format:'markup',visibility:'public',source:'<p>No diagram</p>'},{id:'Doc6',version:1,format:'markup',source:null}])await queueMermaidHarvest(row);
 expect(await harvests()).toEqual([{artifact_id:'Doc1',version:2,engine:MERMAID_RENDER_ENGINE,state:'pending'},{artifact_id:'Doc2',version:1,engine:MERMAID_RENDER_ENGINE,state:'pending'}]);
 expect(wake).toHaveBeenCalledTimes(3);
 onMermaidHarvestQueued(null);await queueMermaidHarvest({id:'Doc7',version:1,format:'markup',source:'Mermaid'});expect(wake).toHaveBeenCalledTimes(3);
});
it('never fails its caller when the queue cannot be written',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const db=await getDb();vi.spyOn(db,'query').mockRejectedValueOnce(Error('database closed'));
 await expect(queueMermaidHarvest({id:'Doc8',version:1,format:'markup',source:'Mermaid'})).resolves.toBeUndefined();
 expect(warn).toHaveBeenCalledWith('[mermaid] could not queue a harvest:','database closed');
});
it('serves a stored drawing’s bytes by its content key only',async()=>{
 const key='b'.repeat(64),svg='<svg xmlns="http://www.w3.org/2000/svg"/>';
 await objectStore().put(mermaidObjectKey(key),svg,'image/svg+xml');
 await (await getDb()).query("INSERT INTO mermaid_images(key,engine,object_key,bytes,info) VALUES($1,$2,$3,$4,'{}'::jsonb),($5,$2,'mermaid/missing.svg',1,'{}'::jsonb)",[key,MERMAID_RENDER_ENGINE,mermaidObjectKey(key),svg.length,'c'.repeat(64)]);
 expect((await mermaidImageBytes(key))?.toString()).toBe(svg);
 for(const bad of ['d'.repeat(64),'c'.repeat(64),'B'.repeat(64),`${key}.svg`,'../etc/passwd',''])expect(await mermaidImageBytes(bad)).toBeNull();
});
