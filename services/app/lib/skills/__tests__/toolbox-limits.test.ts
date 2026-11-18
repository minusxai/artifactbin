/** The skill's copy of the server's size limits is the server's: one number, read by agents and sandboxes. */
import {expect,it} from 'vitest';
import {SERVICE_PAYLOAD_LIMIT} from '@artifactbin/contracts';
import {DRAFT_LIMITS} from '@/lib/page-drafts';

it('ships the service payload limit and the draft limits exactly',async()=>{
 const {PAYLOAD_BYTES,PAGE_LIMITS}=await import('../../../skills/artifactbin/scripts/toolbox-limits.mjs');
 expect(PAYLOAD_BYTES).toBe(SERVICE_PAYLOAD_LIMIT);
 const {files,htmlBytes,fileBytes,totalBytes,rows,columns}=DRAFT_LIMITS;
 expect(PAGE_LIMITS).toEqual({files,htmlBytes,fileBytes,totalBytes,rows,columns});
});
