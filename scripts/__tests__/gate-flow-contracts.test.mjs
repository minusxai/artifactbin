import {it,expect,vi} from 'vitest';
import {toggleArtifactComments} from '../lib/reveal-chrome.mjs';
import {readFileSync} from 'node:fs';
it('targets the comments control inside its named dialog, not the floating duplicate',async()=>{
 const click=vi.fn(),getByLabel=vi.fn(()=>({click})),getByRole=vi.fn(()=>({getByLabel}));
 await toggleArtifactComments({getByRole});
 expect(getByRole).toHaveBeenCalledWith('dialog',{name:'Artifact controls',exact:true});
 expect(getByLabel).toHaveBeenCalledWith('Toggle comments',{exact:true});expect(click).toHaveBeenCalledOnce();
});
it('checks signed-in fixture identity via the validated session, not retired cookie names',()=>{
 for(const file of ['gate-collab-edit.mjs','gate-folders.mjs'])expect(readFileSync(new URL('../'+file,import.meta.url),'utf8')).not.toContain('/better-auth/.test');
});
