/** Standalone HTTP monitor: uses the same watch loop and saved grant as the CLI. */
import type {CommentChangesPage} from '@artifactbin/contracts';
import {credentialRequest} from './credentials';
import {credentialHelperRoot} from './credential-helper-config';
import {watchComments,WatchResponseError} from './comment-watch';
async function main():Promise<void>{
 const args=process.argv.slice(2),flags:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!key||!['--origin','--artifact','--cursor'].includes(key)||value===undefined)throw new Error('Use --origin <origin> --artifact <id> [--cursor <checkpoint>].');flags[key]=value;}
 const origin=flags['--origin'],artifactId=flags['--artifact'];if(!origin||!artifactId)throw new Error('--origin and --artifact are required.');
 const controller=new AbortController();const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  for await(const event of watchComments({artifactId,cursor:flags['--cursor'],signal:controller.signal,
   request:async(path,options)=>{const response=await credentialRequest(origin,credentialHelperRoot(),path,options);if(!response.ok)throw new WatchResponseError(response.status);return await response.json() as CommentChangesPage;},
   onCheckpoint:cursor=>{process.stderr.write(JSON.stringify({checkpoint:cursor})+'\n');},
  }))process.stdout.write(JSON.stringify(event)+'\n');
 }catch(error){if(!controller.signal.aborted)throw error;}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
main().catch(error=>{process.stderr.write((error instanceof Error?error.message:'Comment monitor failed.')+'\n');process.exitCode=1;});
