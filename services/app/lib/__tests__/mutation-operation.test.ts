import {expect,it} from 'vitest';
import {adaptMutationOperationReply,documentMutationReply,mutationInitiator,normalizeMutationOperation} from '../mutation-operation';
it('adapts one domain outcome consistently without exposing its internal edit identity',()=>{
 const saved=documentMutationReply({datasetId:'data',datasetEditId:'edit',version:2,affected:0,rowCount:3,mutationRunId:'opaque-run'});
 expect(adaptMutationOperationReply(saved,'browser')).toEqual({status:200,body:{ok:true,dataset:'data',version:2,affected:0,rowCount:3,mutationRunId:'opaque-run'}});
 expect(adaptMutationOperationReply(saved,'api')).toEqual({status:200,body:{id:'data',version:2,affected:0,rowCount:3,mutationRunId:'opaque-run'}});
});
it('keeps explicit request identity separate from server defaults and operation key',()=>{
 expect(normalizeMutationOperation({documentId:'doc',mutation:'update',args:{},value:null})).toEqual({documentId:'doc',mutation:'update',args:{},value:null});
 expect(mutationInitiator({userId:null,tokenId:'token'},'agent','untrusted label')).toEqual({principal:{kind:'token',id:'token'},execution:'agent',agentLabel:'untrusted label'});
});
