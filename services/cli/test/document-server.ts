/** A protocol model for CLI transport tests. SQL/ACL behavior is covered by the
 * native app tests; these tests exercise the real client and local journal. */
import assert from 'node:assert/strict';
import {createDocumentGraph,graphSource} from '../../app/lib/story/document-graph';
import {applyGraphPatch} from '../../app/lib/story/document-graph-patch';
import {documentAfterOperation} from '../../app/lib/story/document-update-history';
import type {DocumentUpdate,DocumentGraph} from '@artifactbin/contracts';
import {digest} from '../src/files';
export function documentHead<T extends {markup:string;version:number}>(head:T):T&{document:DocumentGraph}{
 return {...head,document:createDocumentGraph(head.markup,head.version)};
}
export function applyDocumentUpdate<T extends {markup:string;version:number;document:DocumentGraph}>(head:T,update:DocumentUpdate):T|null{
 for(const [key,value] of Object.entries(update.expectedMetadata??{}))if((head as Record<string,unknown>)[key]!==value&&((head as Record<string,unknown>)[key]??null)!==value)return null;
 if(update.whole&&head.version!==update.patch.baseVersion)return null;
 const document=update.replacement?documentAfterOperation(head.document,{kind:'operations',version:head.version+1,forward:update.patch,replacement:update.replacement,beforeNodes:{},beforeRevisions:{},beforeBytes:head.document.bytes}):applyGraphPatch(head.document,head.version,update.patch);
 if(!document)return null;
 return {...head,...update.metadata,version:head.version+1,edit_id:`edit-${head.version+1}`,state:digest(`state-${head.version+1}`),document,markup:graphSource(document)};
}
export function acceptedDocumentUpdate<T extends {markup:string;version:number;document:DocumentGraph}>(head:T,update:DocumentUpdate):T{
 const next=applyDocumentUpdate(head,update);assert.ok(next,'Prepared JSONB operation must apply');return next;
}
