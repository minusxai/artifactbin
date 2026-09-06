import {z} from 'zod';
import type {ArtifactRow,TokenActor} from '@/lib/artifacts';
import {ownsArtifact} from '@/lib/artifacts';
import type {StoredContent} from '@/lib/story/input';
import {json} from '@/lib/http';
import {publishDataset} from '@/lib/story/data-tiers';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import type {DatasetCatalog,DatasetTable} from './types';
import {connectionConfig,DatasetError} from './connections';
const identifier=z.string().min(1).max(63).refine(v=>!v.includes('\0'),'Identifier contains a null byte');
const shape=z.object({kind:z.enum(['stored','postgres']),connectionId:z.string().optional(),defaultSchema:identifier.default('public'),refreshSeconds:z.number().int().min(0).max(86400).default(60),tables:z.array(z.object({schema:identifier,name:identifier,source:z.object({schema:identifier,table:identifier}).strict().optional(),columns:z.array(identifier).min(1).optional(),sql:z.string().min(1).max(100000).optional(),rows:z.array(z.record(z.string(),z.unknown())).optional()}).strict()).min(1).max(200)}).strict();

/** Transitional legacy normalization stays at this boundary until catalog migration is complete. */
export function catalogOf(row:{meta:unknown}):DatasetCatalog|null {
 const meta=row.meta as Record<string,unknown>|null;
 if(meta?.catalog)return meta.catalog as DatasetCatalog;
 if(typeof meta?.objectKey==='string')return {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:(meta.columns??[]) as DatasetTable['columns'],objectKey:meta.objectKey}]};
 return null;
}
const key=(table:{schema:string;name:string})=>JSON.stringify([table.schema,table.name]);
export async function prepareCatalog(input:unknown,actor:TokenActor,previous?:ArtifactRow):Promise<StoredContent|Response> {
 try{
  const parsed=shape.safeParse(input);if(!parsed.success)throw new DatasetError(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
  const data=parsed.data;const seen=new Set<string>();for(const t of data.tables){if(seen.has(key(t)))throw new DatasetError('Table names must be unique within a schema');seen.add(key(t));}
  if(!data.tables.some(t=>t.schema===data.defaultSchema))throw new DatasetError('The default schema must exist in the catalog');
  const old=previous?catalogOf(previous):null;
  if(old&&old.defaultSchema!==data.defaultSchema)throw new DatasetError('The default schema is fixed to preserve existing query bindings');
  if(old&&old.kind!==data.kind)throw new DatasetError('Create a new dataset to change its source kind');
  let discovered:import('./types').DiscoveredTable[]=[];
  if(data.kind==='postgres'){
   if(!data.connectionId)throw new DatasetError('Select a Postgres connection');
   const exposure=(ts:typeof data.tables)=>ts.filter(t=>!t.sql).map(t=>({schema:t.schema,name:t.name,source:t.source,columns:t.columns}));
   const priorExposure=old?.tables.filter(t=>!t.sql).map(t=>({schema:t.schema,name:t.name,source:t.source,columns:t.columns.map(c=>c.name)}));
   const sameExposure=old?.connectionId===data.connectionId&&JSON.stringify(exposure(data.tables))===JSON.stringify(priorExposure);
   if(!sameExposure&&previous&&!ownsArtifact(previous,{...actor,tokenId:actor.tokenId}))throw new DatasetError('Only the dataset owner can change source exposure',403);
   const config=await connectionConfig(data.connectionId,sameExposure?undefined:actor);
   const {discoverPostgres}=await import('./postgres');discovered=await discoverPostgres(config);
  }
  const tables:DatasetTable[]=[];
  for(const t of data.tables){
   if(t.sql){if(t.source||t.rows)throw new DatasetError('A model has SQL, not a second source');tables.push({schema:t.schema,name:t.name,sql:t.sql,columns:[]});continue;}
   if(data.kind==='postgres'){
    if(!t.source||!t.columns||t.rows)throw new DatasetError('Choose the source table and exposed columns');
    const source=discovered.find(d=>d.schema===t.source!.schema&&d.name===t.source!.table);
    const columns=t.columns.map(name=>{const c=source?.columns.find(c=>c.name===name);if(!c)throw new DatasetError(`Source column is unavailable: ${t.schema}.${t.name}.${name}`);return c;});
    if(new Set(t.columns).size!==t.columns.length)throw new DatasetError('Columns must be unique');
    tables.push({schema:t.schema,name:t.name,source:t.source,columns});
   }else{
    if(t.source)throw new DatasetError('Stored tables do not have a remote source');
    const prior=old?.tables.find(p=>key(p)===key(t));
    if(!t.rows&&prior?.objectKey){tables.push({...prior});continue;}
    const stored=await publishDataset({},t.rows);if(stored instanceof Response)return stored;
    tables.push({schema:t.schema,name:t.name,columns:stored.meta.columns as DatasetTable['columns'],objectKey:stored.meta.objectKey as string});
   }
  }
  const catalog:DatasetCatalog={kind:data.kind,defaultSchema:data.defaultSchema,refreshSeconds:data.kind==='stored'?0:data.refreshSeconds,...(data.kind==='postgres'?{connectionId:data.connectionId}:{}),tables};
  // Dependencies are probed in topological order by retrying only unknown model shapes.
  const pending=tables.filter(t=>t.sql);let lastError:unknown;
  while(pending.length){let progress=false;
   for(let i=pending.length-1;i>=0;i--){const t=pending[i];try{const {executeCatalog}=await import('./execute');const result=await executeCatalog(catalog,t.sql!,{}, {limit:1,refresh:true});t.columns=result.columns;pending.splice(i,1);progress=true;}catch(error){lastError=error;}}
   if(!progress)throw new DatasetError(lastError instanceof Error?lastError.message:'Model dependencies are invalid or cyclic');
  }
  // Keep the original single-table alias pinned to public.rows; adding tables never rebinds it.
  const legacy=tables.find(t=>t.schema==='public'&&t.name==='rows'&&t.objectKey);
  return {format:'dataset',source:null,content:'',derivedTitle:null,meta:{catalog,...(legacy?{objectKey:legacy.objectKey,columns:legacy.columns}:{}),columns:legacy?.columns??[]}};
 }catch(error){return json({error:'invalid_dataset',details:[error instanceof Error?error.message:'Dataset validation failed']},error instanceof DatasetError?error.status:400);}
}
export async function storedTables(catalog:DatasetCatalog):Promise<Record<string,{rows:Record<string,unknown>[];columns:DatasetTable['columns']}>> {
 return Object.fromEntries(await Promise.all(catalog.tables.map(async(t,i)=>[ `dataset_table_${i}`,{rows:t.objectKey?await loadDatasetRows({content:'',meta:{objectKey:t.objectKey}}):[],columns:t.columns}] as const)));
}
