import {it,expect,vi,afterEach} from 'vitest';
import {createLocalReadBackend} from '../read-backend';
afterEach(()=>vi.unstubAllGlobals());
it('reads permitted comments anonymously and refuses comment writes before sending',async()=>{
 const fetch=vi.fn().mockResolvedValue(Response.json({annotations:[],next_cursor:null}));vi.stubGlobal('fetch',fetch);const backend=createLocalReadBackend('p');expect(await backend.listAnnotations()).toEqual([]);expect(fetch).toHaveBeenCalledWith('/api/my/artifacts/p/annotations',{credentials:'omit'});await expect(backend.createAnnotation({},'key')).rejects.toThrow('read-only');await expect(backend.deleteAnnotation('id')).rejects.toThrow('read-only');await expect(backend.editAnnotation('id',{body:'change'})).rejects.toThrow('read-only');await expect(backend.setCommentReaction('id',{kind:'thumbs_up',active:true})).rejects.toThrow('read-only');expect(backend.unavailable('commentReactions')).toContain('read-only');expect(backend.canDeleteLocalAnnotation?.('id')).toBe(false);expect(fetch).toHaveBeenCalledOnce();
});
