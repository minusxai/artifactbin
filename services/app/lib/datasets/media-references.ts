/** Discover exact references from persisted cells, independently of visible query windows.
 * Reading current immutable objects avoids an index migration or stale edges after mutations.
 * Computed SQL values and connected databases have no stored-cell retention guarantee.
 */
import {catalogFromMetadata} from './catalog-metadata';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import {imageReferenceId} from '@/lib/story/image-source';

export async function storedMediaReferences(row:{meta:unknown}):Promise<Set<string>> {
 const catalog=catalogFromMetadata(row.meta);
 const ids=new Set<string>();
 if(catalog?.kind!=='stored')return ids;
 for(const table of catalog.tables){
  if(table.sql||!table.objectKey)continue;
  const rows=await loadDatasetRows({meta:{objectKey:table.objectKey}});
  for(const cells of rows)for(const value of Object.values(cells)){
   const id=imageReferenceId(value);if(id)ids.add(id);
  }
 }
 return ids;
}
