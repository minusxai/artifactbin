import {DATASET_ROW_ID_COLUMN} from '@artifactbin/contracts';
import {createHash} from 'node:crypto';
import type {DatasetTable} from '@/lib/datasets/types';
import type {DatasetRowIdentitySidecar} from './types';
export const ID_COLUMN=DATASET_ROW_ID_COLUMN;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
export const tableIdentity=(table:Pick<DatasetTable,'schema'|'name'>)=>`t_${digest([table.schema,table.name])}`;
export const initialRowIds=(datasetId:string,tableId:string,objectKey:string,count:number)=>Array.from({length:count},(_,i)=>`r_${digest([datasetId,tableId,objectKey,i])}`);
/** A changed content pointer is a replacement; a matching corrupt sidecar must never reset identities silently. */
export function rowIdsForObject(datasetId:string,tableId:string,objectKey:string,count:number,prior:unknown):readonly string[]{
 if(prior===undefined)return initialRowIds(datasetId,tableId,objectKey,count);
 if(!prior||typeof prior!=='object'||typeof (prior as DatasetRowIdentitySidecar).objectKey!=='string')throw new Error('dataset_row_identity_corrupt');
 const saved=prior as DatasetRowIdentitySidecar;
 if(saved.objectKey!==objectKey)return initialRowIds(datasetId,tableId,objectKey,count);
 if(!Array.isArray(saved.ids)||saved.ids.length!==count||new Set(saved.ids).size!==count||saved.ids.some(id=>typeof id!=='string'||!id))throw new Error('dataset_row_identity_corrupt');
 return saved.ids;
}

export const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
