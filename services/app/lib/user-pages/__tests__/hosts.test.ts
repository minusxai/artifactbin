import {describe,it,expect} from 'vitest';
import {userPagesLabel,handleFromLabel,handleFromUserPagesHost,userPagesOrigin,servesDocument} from '..';
describe('anonymous owner hosts',()=>{
 it('maps shared valid handles reversibly and refuses reserved or invalid identities',()=>{
  expect(userPagesLabel('design_crit')).toBe('design-crit');
  expect(handleFromLabel('design-crit')).toBe('design_crit');
  for(const handle of [null,undefined,'ab','-abc','abc_','app','www','pages','auth','ns1'])expect(userPagesLabel(handle)).toBeNull();
 });
 it('accepts exactly one normalized label and no apex or nested name',()=>{
  expect(handleFromUserPagesHost('Design-Crit.U.Example.com.:4100','u.example.com')).toBe('design_crit');
  for(const host of ['u.example.com','x.design-crit.u.example.com','app.u.example.com','abc.other.com'])expect(handleFromUserPagesHost(host,'u.example.com')).toBeNull();
  expect(userPagesOrigin('design_crit',{app:'http://localhost:4100',host:'u.lvh.me'})).toBe('http://design-crit.u.lvh.me:4100');
 });
 it('serves public and unlisted HTML for the true typed owner only',()=>{
  const user={kind:'user' as const,id:'u1',handle:'alice'},group={kind:'group' as const,id:'g1',handle:'team_one'};
  const row={user_id:'u1',group_id:null,format:'html',visibility:'public',deleted_at:null};
  expect(servesDocument(user,row)).toBe(true);
  expect(servesDocument(user,{...row,visibility:'unlisted'})).toBe(true);
  expect(servesDocument(user,{...row,group_id:'g1'})).toBe(false);
  expect(servesDocument(group,{...row,group_id:'g1'})).toBe(true);
  for(const change of [{visibility:'private'},{deleted_at:'today'},{format:'file'}])expect(servesDocument(user,{...row,...change})).toBe(false);
 });
});
