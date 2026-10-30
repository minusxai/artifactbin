/** Check and stage a verified skill release for the next command. */
import {fileURLToPath} from 'node:url';
import {update,disabled} from './toolbox-update.mjs';
const args=process.argv.slice(2);
if(args.includes('--help'))console.log('Usage: node scripts/update.mjs [--no-update]\nStages a release for the next command; reread the reported SKILL.md.');
else if(!disabled(args))try{const result=await update(fileURLToPath(new URL('../',import.meta.url)));if(!args.includes('--background'))console.log(JSON.stringify(result));}catch(error){if(!args.includes('--background')){console.error('Update failed: '+error.message);process.exitCode=1;}}
