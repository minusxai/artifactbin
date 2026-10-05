import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleBackgroundUpdate,runBackgroundUpdate,backgroundUpdateMain} from '../src/background-update';

test('retired standalone worker cannot launch downloads or replace an executable on any platform',async()=>{
 for(const platform of ['darwin','linux','win32']){
  const options={platform,home:'/unused',server:'https://example.test',standalone:true,launch:()=>assert.fail('no detached updater'),update:async()=>assert.fail('no update')};
  await scheduleBackgroundUpdate(options);await runBackgroundUpdate(options);await backgroundUpdateMain(['/unused','https://example.test','launch'],options);
 }
});
