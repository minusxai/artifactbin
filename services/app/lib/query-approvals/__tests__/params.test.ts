/**
 * WHAT A READER MAY SEND to an approved query (`paramsOutside`): only the parameters the approval names, each by its own
 * rule. A name the approval does not hold itself (an object's built-ins: `constructor`, `__proto__`, `toString`) is no
 * parameter of it, whatever its value.
 */
import {expect,it} from 'vitest';
import {paramsOutside} from '..';

it('refuses a parameter the approval does not name, built-in object names included, and admits only the ones it does',()=>{
 const allowed={region:{values:['EU','US']},since:{type:'date'}} as const;
 expect(paramsOutside(allowed,{region:'EU',since:'2026-01-02'},[])).toBeNull();
 for(const name of ['constructor','toString','hasOwnProperty','valueOf','__proto__'])
  expect(paramsOutside(allowed,JSON.parse(`{"${name}":"2026-01-02"}`),[]),name).toBe(`${name} cannot be set for this query.`);
 expect(paramsOutside(allowed,{region:'APAC'},[])).toBe('That value of region is not allowed for this query.');
 // Its rules are read as the approval's own, never inherited.
 expect(paramsOutside(Object.assign(Object.create({region:{type:'text'}}),{}),{region:'EU'},[])).toBe('region cannot be set for this query.');
});
