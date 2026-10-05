import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateCli} from '../src/update';
import {commandHelp} from '../src/commands';
import {diagnosticCatalog} from '../src/diagnostics';

test('explicit update gives npm instructions without network, executable changes, or skill installation',async()=>{
 for(const platform of ['darwin','linux','win32']){
  const result=await updateCli({platform,home:'/unused',server:'https://example.test',harnesses:[],fetch:async()=>assert.fail('no network'),chooseHarnesses:async()=>assert.fail('no installation')});
  assert.equal(result.command,`${platform==='win32'?'npx.cmd':'npx'} --yes @afbin/cli@latest <command>`);assert.equal(result.update_required,false);
 }
});
test('update help and incompatible-client recovery describe explicit npm launches',()=>{
 assert.match(commandHelp('update'),/next.*npm|npm.*next/i);
 assert.doesNotMatch(commandHelp('update'),/Update the compatible CLI/);
 assert.match(diagnosticCatalog.cli_update_required.fix,/npx --yes @afbin\/cli@latest/);
 assert.match(diagnosticCatalog.cli_update_required.fix,/npx.cmd/);
 assert.doesNotMatch(diagnosticCatalog.compatible_release_unavailable.fix,/afbin update --dry-run reports what it resolved/);
});
test('update dry run is instruction-only too',async()=>{
 const result=await updateCli({home:'/unused',server:'https://example.test',harnesses:[],dryRun:true});assert.equal(result.dry_run,true);
});
