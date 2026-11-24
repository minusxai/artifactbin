import {expect,it} from 'vitest';
import {normalizeCreateGroup} from '../src/groups';
import {isValidHandle} from '../src/handles';
import {validSiteAlias} from '../src/site-alias';

it('reserves the flat alias delimiter for accounts and groups, including the IDNA prefix',()=>{
  for(const handle of ['a__b','xn__bcher_kva','_team','team_']){
    expect(isValidHandle(handle)).toBe(false);
    expect(normalizeCreateGroup({handle,name:'Team'})).toBeNull();
  }
  expect(normalizeCreateGroup({handle:'team_one',name:'Team'})?.handle).toBe('team_one');
});

it('budgets the owner, separator and suffix in the same DNS label and full hostname',()=>{
  const owner='a'.repeat(32),base=owner+'.example.test';
  expect(validSiteAlias('b'.repeat(29),base)).toBe(true);
  expect(validSiteAlias('b'.repeat(30),base)).toBe(false);
  const longHost=[owner,...Array(3).fill('b'.repeat(63)),'c'.repeat(25)].join('.');
  expect(validSiteAlias('x',longHost)).toBe(true);
  expect(validSiteAlias('xx',longHost)).toBe(false);
});

it('keeps the double hyphen exclusively between the owner and the alias',()=>{
  expect(validSiteAlias('research-notes','owner.example.test')).toBe(true);
  expect(validSiteAlias('research--notes','owner.example.test')).toBe(false);
});
