/**
 * Example: dataset rules for examples/shared-app.html's targets dataset: everyone who can open the
 *   page reads every row; shared viewers and signed-in link holders add, change and delete any row
 *   (the budget resolver's caps.query writes as them); signed-out readers change nothing.
 * Usage: node scripts/new-app.mjs applies these rules itself; no reading or editing needed. By
 *   hand: node scripts/policy.mjs get TARGETS_ID --output policy.json, then
 *   node examples/shared-app-policy.mjs policy.json (rewrites its rules, keeps its revision), then
 *   node scripts/policy.mjs set TARGETS_ID --file policy.json --dry-run; read readBack, then the
 *   same set without --dry-run.
 * Gotchas: each request matches exactly one role, so the write rules list viewer and signed_in.
 *   Owners and editors always have full access. Own rows only (each person edits what they added):
 *   policy.mjs template own-rows ID --owner-column COLUMN instead.
 */
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read={columns:'*',filter:{},allow_aggregations:true},writers=['viewer','signed_in'];
/** The policy with every table's rules replaced by the shared-targets ones (configuration kept). */
export const sharedTargetsPolicy=policy=>({...policy,tables:policy.tables.map(({table,
 configuration})=>({table,...(configuration?{configuration}:{}),
 select_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{...read}})),
 insert_permissions:writers.map(role=>({role,permission:{columns:'*',check:{}}})),
 update_permissions:writers.map(role=>({role,permission:{columns:'*',filter:{},check:{}}})),
 delete_permissions:writers.map(role=>({role,permission:{filter:{}}}))}))});
export const SUMMARY='everyone reads; viewer and signed_in add, change and delete rows';
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=process.argv[2];
 if(!file){console.error('Usage: node examples/shared-app-policy.mjs policy.json');process.exit(2);}
 const saved=JSON.parse(readFileSync(file,'utf8')),policy=sharedTargetsPolicy(saved.policy??saved);
 writeFileSync(file,JSON.stringify(saved.policy?{...saved,policy}:policy,null,1));
 console.log(`${file}: ${SUMMARY}`);
}
