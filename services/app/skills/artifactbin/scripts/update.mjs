/** Activate a verified release, or roll back offline. */
import {fileURLToPath} from 'node:url';
import {update,disabled} from './toolbox-update.mjs';
const args=process.argv.slice(2);
const unknown=args.find(arg=>!['--help','--no-update','--background','--rollback'].includes(arg));
if(unknown){console.error('Unknown option: '+unknown);process.exitCode=2;}
else if(args.includes('--help'))console.log('Usage: node scripts/update.mjs [--no-update] [--rollback]\nUpdates the canonical installation. --rollback selects the prior verified release offline. Reread canonical SKILL.md and reload your harness. --no-update disables checks, staging and activation.');
else if(!disabled(args))try{const result=await update(fileURLToPath(new URL('../',import.meta.url)),{background:args.includes('--background'),rollback:args.includes('--rollback')});if(!args.includes('--background'))console.log(JSON.stringify(result));}catch(error){if(!args.includes('--background')){console.error('Update failed: '+error.message);process.exitCode=1;}}
