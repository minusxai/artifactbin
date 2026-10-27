import {runTool,positional,integer,ToolError} from './toolbox-client.mjs';
import {startPreview} from './preview.mjs';
export async function serveCommand({values,positionals}){
 if(values.server)throw new ToolError('unsupported_server','Private serve does not connect to a remote server.',2);
 const session=await startPreview({root:positional(positionals),port:values.port===undefined?0:integer(values.port,'port',0,65535),runtimeDir:values['runtime-dir'],autofix:{write:values.autofix===true,report:text=>process.stderr.write(text)}});
 const receipt={ok:true,code:'serving',url:session.url,private:true,note:'Loopback preview; local dataset edits are in memory. Ctrl-C stops it.'};
 if(values.output){const {exclusive}=await import('./toolbox-client.mjs');await exclusive(values.output,JSON.stringify(receipt)+'\n');}
 process.stdout.write(JSON.stringify(receipt)+'\n');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void session.close();});
}
await runTool('serve',import.meta.url,serveCommand);
