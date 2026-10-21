import { FileServer } from './durable.ts';
const [path,point]=process.argv.slice(2);
await new FileServer(path,p=>{if(p===point)process.kill(process.pid,'SIGKILL');}).commit({id:'durable',epoch:1,schema:1,baseVersion:0,key:'item',value:'saved',expiresAt:100},{canWrite:true},0);
throw Error('Crash hook was not reached');
