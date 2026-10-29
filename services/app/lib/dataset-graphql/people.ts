import type {DatasetPerson,PersonCard} from '@artifactbin/contracts';
import type {DatasetSnapshot} from './types';
import type {DatasetTable} from '@/lib/datasets';
export interface DatasetPeopleReadPort {
 rows(table:DatasetTable):Promise<readonly Record<string,unknown>[]>;
 cards(ids:string[]):Promise<Record<string,PersonCard>>;
 /** Same dataset ACL and immutable source/policy binding, checked before and after reads. */
 verify():Promise<void>;
}
/** A supplied id only narrows actual typed user references; ordinary text never
 * grants person lookup. Missing/deleted accounts stay absent, with no raw-id name. */
export async function readDatasetPeople(snapshot:DatasetSnapshot,ids:readonly string[],port:DatasetPeopleReadPort,signal:AbortSignal):Promise<DatasetPerson[]> {
 const verify=async()=>{signal.throwIfAborted();await port.verify();};
 await verify();
 const wanted=new Set(ids),allowed=new Set<string>();
 for(const table of snapshot.catalog.tables){
  const columns=table.columns.filter(column=>column.type==='user');
  if(!columns.length)continue;
  for(const row of await port.rows(table))for(const column of columns){const id=row[column.name];if(typeof id==='string'&&wanted.has(id))allowed.add(id);}
 }
 await verify();
 const cards=allowed.size?await port.cards([...allowed]):{};
 await verify();
 return [...new Set(ids)].flatMap(id=>allowed.has(id)&&cards[id]?[{id,...cards[id]}]:[]);
}
