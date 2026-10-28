import type {ArtifactReservationPoolPorts} from './reservation-pool-contracts';
/** Keep the public 100-slot pool and 1,000-candidate collision budget. */
export async function reserveArtifactIdentityPool(ports:ArtifactReservationPoolPorts):Promise<string[]>{
 const ids:Array<string|undefined>=Array.from({length:100},()=>undefined);
 let attempts=0;
 while(ids.some(id=>id===undefined)&&attempts<1000){
  const ordinals=ids.flatMap((id,ordinal)=>id===undefined?[ordinal]:[]).slice(0,1000-attempts);
  const candidates=ordinals.map(ordinal=>({id:ports.generate(),ordinal}));
  attempts+=candidates.length;
  const reserved=await ports.insert(candidates);
  for(const candidate of reserved){
   if(!candidates.some(expected=>expected.ordinal===candidate.ordinal&&expected.id===candidate.id)||ids[candidate.ordinal]!==undefined)throw Error('Invalid ID reservation result');
   ids[candidate.ordinal]=candidate.id;
  }
 }
 if(ids.some(id=>id===undefined))throw Error('ID allocation exhausted');return ids as string[];
}
