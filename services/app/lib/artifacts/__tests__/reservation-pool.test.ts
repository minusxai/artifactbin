import {expect,it} from 'vitest';
import {reserveArtifactIdentityPool} from '../reservation-pool';
import type {ArtifactReservationCandidate} from '../reservation-pool-contracts';
it('reserves the 100 public slots in one independent insert and keeps canonical ordinals',async()=>{
 let next=0;const calls:ArtifactReservationCandidate[][]=[];
 const ids=await reserveArtifactIdentityPool({generate:()=>`id${next++}`,insert:async candidates=>{calls.push([...candidates]);return [...candidates].reverse();}});
 expect(calls).toHaveLength(1);expect(calls[0]).toHaveLength(100);expect(ids).toEqual(Array.from({length:100},(_,i)=>`id${i}`));
});
it('refills only collided slots without duplicates or reordering successful ordinals',async()=>{
 let next=0;const occupied=new Set(['id1','id3']),calls:ArtifactReservationCandidate[][]=[];
 const ids=await reserveArtifactIdentityPool({generate:()=>next++===5?'id4':`id${next-1}`,insert:async candidates=>{calls.push([...candidates]);return candidates.filter(candidate=>{if(occupied.has(candidate.id))return false;occupied.add(candidate.id);return true;}).reverse();}});
 expect(calls.map(c=>c.length)).toEqual([100,3]);expect(ids).toHaveLength(100);expect(new Set(ids).size).toBe(100);expect(ids[0]).toBe('id0');expect(ids[1]).toBe('id100');expect(ids[2]).toBe('id2');expect(ids[3]).toBe('id101');expect(ids[4]).toBe('id4');expect(ids[5]).toBe('id102');
});
it('retains the bounded collision budget and fails instead of returning a partial pool',async()=>{
 let generated=0,calls=0;
 await expect(reserveArtifactIdentityPool({generate:()=>{generated++;return 'taken';},insert:async()=>{calls++;return [];}})).rejects.toThrow('ID allocation exhausted');
 expect(generated).toBe(1000);expect(calls).toBe(10);
});
it('stops after an insert failure without consuming another wave',async()=>{
 let generated=0;await expect(reserveArtifactIdentityPool({generate:()=>`id${generated++}`,insert:async()=>{throw Error('database unavailable');}})).rejects.toThrow('database unavailable');expect(generated).toBe(100);
});
it('does not generate extra candidates when a partially filled pool reaches its collision budget',async()=>{
 let generated=0,calls=0;
 await expect(reserveArtifactIdentityPool({generate:()=>`id${generated++}`,insert:async candidates=>calls++===0?[candidates[0]!]:[]})).rejects.toThrow('ID allocation exhausted');
 expect(generated).toBe(1000);
});
