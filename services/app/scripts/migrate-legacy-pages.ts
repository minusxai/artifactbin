/** Local operator for administrators: default dry-run; only --apply commits. Output contains aggregate counts only. */
import {getDb} from '../lib/platform';
import {migrateLegacyPage} from '../lib/artifacts';
import {LiveRegionRefusal} from '../lib/live-regions';
const args=process.argv.slice(2);
const apply=args.includes('--apply');
const ids=args.filter(arg=>arg!=='--apply');
if(!ids.length||ids.some(id=>id.startsWith('-')))throw new Error('Usage: tsx services/app/scripts/migrate-legacy-pages.ts [--apply] ID...');
const counts:Record<string,number>={};
const refusals:Record<string,number>={};
for(const id of ids){
 let result:string;
 try{result=await migrateLegacyPage(id,{apply});}catch(error){
  result='refused';
  // Fixed categories only: details/messages can contain authored data or secrets.
  const reason=error instanceof LiveRegionRefusal?error.code:'unexpected_error';
  refusals[reason]=(refusals[reason]??0)+1;
 }
 counts[result]=(counts[result]??0)+1;
}
console.log(JSON.stringify({apply,counts,refusals}));
process.exitCode=counts.refused?1:0;

await (await getDb()).close();
