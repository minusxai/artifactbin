// CI-only Docker checks. This trusted probe intentionally bypasses V8 to test the outer boundary.
import {spawnSync} from 'node:child_process';
const image=process.argv[2];if(!image)throw Error('image required');
const options=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--memory','192m','--cpus','1','--pids-limit','32','--entrypoint','node',image];
const code=`const fs=require('node:fs'),net=require('node:net');
if(process.getuid()!==1000)throw Error('root');
for(const p of ['/tmp/forbidden','/validation/forbidden']){let denied=false;try{fs.writeFileSync(p,'bad')}catch{denied=true}if(!denied)throw Error('writable root');}
if(fs.readFileSync('/proc/self/status','utf8').match(/NoNewPrivs:\\s+(\\d)/)?.[1]!=='1')throw Error('privileges');
if(!fs.readFileSync('/proc/self/status','utf8').match(/CapEff:\\s+0+\\s/))throw Error('capabilities');
if(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim()!=='201326592')throw Error('memory');
if(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim()!=='32')throw Error('pids');
if(fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim()!=='100000 100000')throw Error('cpu');
const sock=net.connect({host:'1.1.1.1',port:443});sock.on('connect',()=>{throw Error('network available')});sock.on('error',()=>console.log('non-root, read-only, no capabilities, no new privileges, cgroups and network denial verified'));sock.setTimeout(1000,()=>{sock.destroy();console.log('network blocked by timeout')});`;
const result=spawnSync('docker',[...options,'-e',code],{encoding:'utf8',timeout:10000});process.stdout.write(result.stdout);if(result.status!==0)throw Error(result.stderr||'boundary probe failed');
const oom=spawnSync('docker',[...options,'-e','const a=[];while(true)a.push(Buffer.alloc(8*1024*1024,1))'],{encoding:'utf8',timeout:15000});if(oom.status!==137)throw Error(`expected cgroup OOM kill, got ${oom.status}: ${oom.stderr}`);console.log('cgroup OOM kills only the leased worker');
