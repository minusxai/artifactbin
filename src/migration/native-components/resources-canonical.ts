import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {resourceSha256,type NativeResourceAsset} from './resources.ts';
interface Receipt {path:string;sha256:string}
interface AssetReference {artifactId:string;version:number;variant:string;width?:number}
/** Read-only canonical export admission. Uses exported snapshots, never source APIs or current assets. */
export async function canonicalNativeAssets(root:string,sources:readonly string[]):Promise<{assets:NativeResourceAsset[];rows:Record<string,unknown>[];missingOriginal:string[];provenanceSha256:string}>{
 const base=await realpath(root),closure=path.join(base,'closure');
 const read=async(file:string)=>{const resolved=await realpath(path.resolve(closure,file));if(!resolved.startsWith(base+path.sep))throw Error('Canonical resource escapes export');return readFile(resolved);};
 const manifestBytes=await read('manifest.json'),manifest=JSON.parse(manifestBytes.toString()) as {dependencyReceipts:Receipt[];missingReferenceIds:string[]};
 const planBytes=await read('asset-plan.json'),plan=JSON.parse(planBytes.toString()) as {plan:{objects:{objectKey:string;contentType:string;references:AssetReference[]}[]}};
 const objectBytes=await read('object-receipts.json'),objects=JSON.parse(objectBytes.toString()) as {objectKey:string;status:string;path:string;sha256:string}[];
 const provenanceSha256=resourceSha256(Buffer.concat([manifestBytes,planBytes,objectBytes]));
 const requests=sources.flatMap(source=>{if(source.startsWith('ref:'))return [{source,id:source.slice(4),version:undefined as number|undefined}];const raw=/^\/a\/([^/?#]+)\/raw\?v=(\d+)(?:&w=\d+)?$/.exec(source);return raw?[{source,id:raw[1]!,version:Number(raw[2])}]:[];});
 const wanted=new Set(requests.map(request=>request.id)),heads=new Map<string,Record<string,unknown>>(),versions=new Map<string,Record<string,unknown>>();
 for(const receipt of manifest.dependencyReceipts){const bytes=await read(receipt.path);if(resourceSha256(bytes)!==receipt.sha256)throw Error('Canonical dependency digest changed');const snapshot=JSON.parse(bytes.toString()) as {heads:Record<string,unknown>[];versions?:Record<string,unknown>[]};for(const row of snapshot.heads)if(wanted.has(String(row.id))){heads.set(String(row.id),row);versions.set(`${row.id}:${row.version}`,row);}for(const row of snapshot.versions??[])if(wanted.has(String(row.artifact_id)))versions.set(`${row.artifact_id}:${row.version}`,row);}
 const assets:NativeResourceAsset[]=[],missingOriginal:string[]=[];
 for(const {source,id,version:requestedVersion} of requests){const row=requestedVersion===undefined?heads.get(id):versions.get(`${id}:${requestedVersion}`);if(!row){missingOriginal.push(source);continue;}
  if(row.format!=='image'&&row.format!=='file'&&row.format!=='pdf'){missingOriginal.push(source);continue;}
  const version=Number(row.version),variants=plan.plan.objects.filter(object=>object.references.some(ref=>ref.artifactId===id&&ref.version===version));
  let full=false;
  for(const variant of variants){const ref=variant.references.find(ref=>ref.artifactId===id&&ref.version===version)!;if(!['original','small'].includes(ref.variant))continue;
   const receipt=objects.find(object=>object.objectKey===variant.objectKey&&object.status==='copied');if(!receipt)throw Error('Canonical object receipt missing');const bytes=await read(receipt.path);if(resourceSha256(bytes)!==receipt.sha256)throw Error('Canonical object digest changed');
   const raw=`/a/${id}/raw?v=${version}`,meta=row.meta as {smallWidth?:number}|undefined;const aliases=ref.variant==='original'?[...(source.startsWith('ref:')?[source]:[]),raw]:[raw+`&w=${ref.width??meta?.smallWidth}`];if(ref.variant==='original')full=true;
   const extension:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','application/pdf':'pdf','image/avif':'avif'};
   assets.push({sources:aliases,bytes,sha256:receipt.sha256,extension:extension[variant.contentType]??'bin',provenanceSha256});
  }
  if(!full)missingOriginal.push(source);
 }
 return {assets,rows:[...heads.values()],missingOriginal:[...new Set(missingOriginal)],provenanceSha256};
}
