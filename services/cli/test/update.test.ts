import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateCli} from '../src/update';

test('explicit update gives npm instructions without network, executable changes, or skill installation',async()=>{
 for(const platform of ['darwin','linux','win32']){
  const result=await updateCli({platform,home:'/unused',server:'https://example.test',harnesses:[],fetch:async()=>assert.fail('no network'),chooseHarnesses:async()=>assert.fail('no installation')});
  assert.equal(result.command,'npx --yes @afbin/cli@latest <command>');assert.equal(result.update_required,false);
 }
});
test('update dry run is instruction-only too',async()=>{
 const result=await updateCli({home:'/unused',server:'https://example.test',harnesses:[],dryRun:true});assert.equal(result.dry_run,true);
});
