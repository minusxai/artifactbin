import {seedOwnerJoin} from '@/lib/accounts';
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/platform';
import {hasExplicitNotificationMembership} from '@/lib/notifications';
useAppHarness();
it('does not treat an automatically accepted invitation as explicit artifact consent',async()=>{
 const db=await getDb();
 await db.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at) VALUES('user','recipient','join','artifact','document','accepted','invitation','sender',now())");
 expect(await hasExplicitNotificationMembership(db,'document','recipient')).toBe(false);
});
it('read access without a joined relation never qualifies',async()=>{
 expect(await hasExplicitNotificationMembership(await getDb(),'publicdoc','recipient')).toBe(false);
});

it('seeds owner consent that a left relation withdraws',async()=>{
 const db=await getDb();
 await seedOwnerJoin(db,'document','owner');
 expect(await hasExplicitNotificationMembership(db,'document','owner')).toBe(true);
 await db.query("UPDATE relations SET deleted_at=now() WHERE subject_id='owner'");
 expect(await hasExplicitNotificationMembership(db,'document','owner')).toBe(false);
});
