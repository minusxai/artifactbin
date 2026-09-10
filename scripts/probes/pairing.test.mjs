import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pairing } from './pairing.mjs';
test('headless pairing keeps polling secret distinct from browser code and issues once', () => {
 const p=new Pairing(); const r=p.begin('https://example.com',1000);
 assert.notEqual(r.deviceSecret,r.userCode); assert.equal(p.poll(r.deviceSecret,1001).status,'pending');
 assert.throws(()=>p.poll(r.userCode,1001),/unknown/);
 p.approve(r.userCode,{userId:'usr_test',origin:'https://example.com'},1002);
 assert.deepEqual(p.poll(r.deviceSecret,1003),{status:'approved',userId:'usr_test',origin:'https://example.com'});
 assert.throws(()=>p.poll(r.deviceSecret,1004),/consumed/);
});
test('approval cannot change origin, complete without identity, or survive expiry/denial',()=>{
 const p=new Pairing(); const a=p.begin('https://one.example',1000);
 assert.throws(()=>p.approve(a.userCode,{userId:'u',origin:'https://two.example'},1001),/origin/);
 assert.throws(()=>p.approve(a.userCode,{origin:'https://one.example'},1001),/identity/);
 assert.throws(()=>p.approve(a.userCode,{userId:'u',origin:'https://one.example'},301001),/expired/);
 const b=p.begin('https://one.example',1000); p.deny(b.userCode,1001);
 assert.equal(p.poll(b.deviceSecret,1002).status,'denied');
 assert.throws(()=>p.approve(b.userCode,{userId:'u',origin:'https://one.example'},1003),/denied/);
});
