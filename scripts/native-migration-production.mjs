#!/usr/bin/env node
// Run with: node --import tsx scripts/native-migration-production.mjs CONFIG [--apply --approved-plan SHA --approved-config SHA]
import {runNativeProductionCli} from './lib/native-migration-production-cli.mjs';
const args=process.argv.slice(2),configPath=args.shift();
try{
 if(!configPath||args.some((arg,index)=>arg!=='--apply'&&arg!=='--approved-plan'&&arg!=='--approved-config'&&args[index-1]!=='--approved-plan'&&args[index-1]!=='--approved-config'))throw Error('native_production_cli_usage');
 const configIndex=args.indexOf('--approved-config');
 const approvedIndex=args.indexOf('--approved-plan');
 const receipt=await runNativeProductionCli({configPath,apply:args.includes('--apply'),approvedPlanSha256:approvedIndex<0?undefined:args[approvedIndex+1],approvedConfigSha256:configIndex<0?undefined:args[configIndex+1]});
 console.log(JSON.stringify(receipt));
}catch(error){const code=error?.message;console.error(typeof code==='string'&&/^native[_-][a-z0-9_-]+$/.test(code)?code:'native_production_cli_failed');process.exitCode=1;}
