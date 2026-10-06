import {services} from '../platform/services';
import type {RemoteSessionInfo,RemoteView} from '../../../contracts/src/remote';
import {RemoteError} from './registry';
import {isTerminalManagedRun} from './managed-status';
export async function managedTerminalView(owner:string,info:RemoteSessionInfo):Promise<RemoteView>{
 const runner=services().runner;
 if(!info.runId||!runner.terminal)throw new RemoteError('Managed terminal unavailable',503);
 const lookup={userId:owner,runId:info.runId};
 const run=await runner.getRun(lookup);
 const progress=(message:string):RemoteView=>({session:{...info,online:false,activity:isTerminalManagedRun(run.status)?'stopped':info.activity==='stopping'?'stopping':'starting'},generation:info.runId,seq:0,frames:[],snapshot:message+'\r\n'});
 if(run.status==='queued')return progress(info.activity==='stopping'?'Stopping your hosted box…':'Starting your hosted box…');
 let terminal;
 try{terminal=await runner.terminal(lookup);}
 catch(error){if(error instanceof Error&&error.message==='terminal_unavailable')return progress(isTerminalManagedRun(run.status)?`Run ${run.status}. Your home files are retained.`:info.activity==='stopping'?'Stopping your hosted box…':'Starting your hosted box…');throw error;}
 const finished=isTerminalManagedRun(run.status);
 const ssh=terminal.ssh;
 const host=ssh?.host??ssh?.hostname;
 const key=ssh?.hostKey?.trim().split(/\s+/).slice(0,2).join(' ');
 const sshHostKey=host&&key?`${(ssh?.port??22)===22?host:`[${host}]:${ssh!.port}`} ${key}`:undefined;
 const sshCommand=ssh?.command??((ssh?.host||ssh?.hostname)&&ssh.username?`ssh -p ${ssh.port??22} ${ssh.username}@${ssh.host??ssh.hostname}`:undefined);
 const activity=finished?'stopped':info.activity==='stopping'?'stopping':'working';
 return {session:{...info,online:!finished&&activity!=='stopping',activity,...(sshCommand?{sshCommand}:{}),...(sshHostKey?{sshHostKey}:{})},generation:info.runId,seq:terminal.seq??terminal.snapshot.length,frames:[],snapshot:terminal.snapshot};
}
export async function managedTerminalInput(owner:string,info:RemoteSessionInfo,text:string){
 const runner=services().runner;
 if(!info.runId||!runner.write)throw new RemoteError('Managed terminal unavailable',503);
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw new RemoteError('Invalid terminal input');
 await runner.write({userId:owner,runId:info.runId,text});
}
export async function stopManagedTerminal(owner:string,info:RemoteSessionInfo){
 if(!info.runId)throw new RemoteError('Session not found',404);
 await services().runner.cancel({userId:owner,runId:info.runId});
}
