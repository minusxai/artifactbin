import {describe,it,expect} from 'vitest';
import type {DatasetGrantPolicy,DatasetGrantContext} from '@artifactbin/contracts';
import {imageInsertAllowed} from '../image-upload-policy';
const context:DatasetGrantContext={caller:{userId:'reporter',tokenId:null},owner:{userId:'owner',tokenId:null},artifact:{id:'DOC123',owner:{userId:'owner',tokenId:null}}};
const policy=(actions:('read'|'insert'|'update'|'delete')[]):DatasetGrantPolicy=>({version:2,allow:[{actions,from:{artifact:'DOC123'}}]});
describe('feedback image upload permission',()=>{
 it('allows the exact authorized parent-context insert grant',()=>expect(imageInsertAllowed(policy(['insert']),context)).toBe(true));
 it('refuses read/update/delete rights without insert',()=>{for(const actions of [['read'],['update'],['delete']] as const)expect(imageInsertAllowed(policy([...actions]),context)).toBe(false);});
 it('requires matching established document context',()=>{expect(imageInsertAllowed(policy(['insert']),{caller:context.caller,owner:context.owner})).toBe(false);expect(imageInsertAllowed(policy(['insert']),{...context,artifact:{id:'OTHER1',owner:{userId:'owner',tokenId:null}}})).toBe(false);});
 it('missing policy refuses rather than defaulting to write',()=>expect(imageInsertAllowed(null,context)).toBe(false));
});
