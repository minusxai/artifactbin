import {expect,it} from 'vitest';
import { adaptMutationOperationReply, normalizeMutationOperation } from '@/lib/document-data';
it('adapts one domain outcome consistently without exposing its internal edit identity',()=>{
 const saved={status:200,body:{mutationOperation:{datasetId:'data',datasetEditId:'edit',version:2,affected:0,rowCount:3}}};
 expect(adaptMutationOperationReply(saved,'browser')).toEqual({status:200,body:{ok:true,dataset:'data',version:2,affected:0,rowCount:3}});
 expect(adaptMutationOperationReply(saved,'api')).toEqual({status:200,body:{id:'data',version:2,affected:0,rowCount:3}});
});
it('keeps explicit request identity separate from server defaults and operation key',()=>{
 expect(normalizeMutationOperation({documentId:'doc',mutation:'update',args:{},value:null})).toEqual({documentId:'doc',mutation:'update',args:{},value:null});
});
