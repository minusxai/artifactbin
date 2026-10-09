import {watchComments} from '@artifactbin/utils/comment-watch';
import type {CommentChangesPage} from '@artifactbin/contracts';
import {CliError,type ParsedCommand} from './commands';
import {resolveReference} from './reference';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';
/** Signals belong to this foreground command; remove both handlers on every exit. */
export async function watchCommand(workspace:Workspace,parsed:ParsedCommand,client:HttpClient,options:{stdout:(value:string)=>void;stderr:(value:string)=>void;signal?:AbortSignal}):Promise<void>{
 if(!parsed.flags.comments||!parsed.flags.json)throw new CliError('invalid_arguments','Use afbin watch <url|id> --comments --json.');
 const ref=await resolveReference(parsed.positionals[0]!,{root:workspace.root,cwd:workspace.cwd,server:client.connection.server,aliases:[...client.aliases]});
 if(ref.kind!=='id'||ref.version!==undefined)throw new CliError('invalid_reference','Watch a published artifact URL or ID without @version.');
 const controller=new AbortController(),stop=()=>controller.abort();
 const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  for await(const event of watchComments({artifactId:ref.id,signal,cursor:typeof parsed.flags.cursor==='string'?parsed.flags.cursor:undefined,
   request:(path,requestOptions)=>client.request<CommentChangesPage>(path,'GET',undefined,{},requestOptions),
   onCheckpoint:cursor=>{options.stderr(JSON.stringify({checkpoint:cursor})+'\n');},
   onRetry:attempt=>options.stderr(`Comment watch reconnecting (attempt ${attempt}).\n`),
  })){if(signal.aborted)return;options.stdout(JSON.stringify(event)+'\n');}
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
