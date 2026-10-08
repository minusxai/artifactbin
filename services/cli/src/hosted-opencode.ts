import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const openCodeId=/^ses_[a-zA-Z0-9]+$/;

function inside(parent:string,child:string):boolean {
 const path=relative(parent,child);
 return path!==''&&!path.startsWith(`..${sep}`)&&path!=='..'&&!isAbsolute(path);
}

/**
 * OpenCode 1.18.35 has no public session-directory update API. Before resuming a
 * managed session, move only its persisted directory pointer from shared HOME
 * into this agent's cwd. The database is explicitly per-agent and vendor-owned.
 */
export async function relocatePinnedOpenCodeSession(options:{home:string;cwd:string;stateDirectory:string;databasePath:string|undefined;sessionId:string}):Promise<'unchanged'|'relocated'> {
 const home=resolve(options.home),cwd=resolve(options.cwd),stateDirectory=resolve(options.stateDirectory);
 if(!openCodeId.test(options.sessionId))throw new Error('invalid_opencode_session_id');
 if(!isAbsolute(options.home)||!isAbsolute(options.cwd)||!isAbsolute(options.stateDirectory))throw new Error('invalid_opencode_private_database_path');
 if(home===cwd)return 'unchanged';
 const expected=resolve(stateDirectory,'opencode.db');
 if(!options.databasePath||resolve(options.databasePath)!==expected||!inside(cwd,stateDirectory))throw new Error('opencode_private_database_required');

 // Reject symlinked path components and non-regular or multiply-linked DB files.
 // `realpath` additionally ensures the private state directory resolves under cwd.
 const realCwd=await realpath(cwd),realState=await realpath(stateDirectory);
 if(!inside(realCwd,realState))throw new Error('opencode_private_database_required');
 let current=cwd;
 for(const part of relative(cwd,stateDirectory).split(sep)){
  if(!part)continue;
  current=resolve(current,part);
  const info=await lstat(current);
  if(info.isSymbolicLink()||!info.isDirectory())throw new Error('opencode_private_database_required');
 }
 const fileInfo=await lstat(expected);
 if(fileInfo.isSymbolicLink()||!fileInfo.isFile()||fileInfo.nlink!==1)throw new Error('opencode_private_database_required');
 const openedInfo=await realpath(expected);
 if(openedInfo!==resolve(realState,'opencode.db'))throw new Error('opencode_private_database_required');

 const db=new DatabaseSync(expected);
 try{
  const afterOpen=await lstat(expected);
  if(afterOpen.isSymbolicLink()||afterOpen.dev!==fileInfo.dev||afterOpen.ino!==fileInfo.ino)throw new Error('opencode_private_database_changed');
  // Check for the native schema shape before taking a write lock. Do not run
  // migrations, create tables, or open a missing database as a new file.
  const tables=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(row=>row.name));
  const sessionColumns=new Set((db.prepare('PRAGMA table_info(session)').all() as Array<{name:string}>).map(row=>row.name));
  const messageColumns=new Set((db.prepare('PRAGMA table_info(message)').all() as Array<{name:string}>).map(row=>row.name));
  const partColumns=new Set((db.prepare('PRAGMA table_info(part)').all() as Array<{name:string}>).map(row=>row.name));
  if(!['session','message','part','project'].every(name=>tables.has(name))
    ||!['id','directory','project_id'].every(name=>sessionColumns.has(name))
    ||!['id','session_id'].every(name=>messageColumns.has(name))
    ||!['id','message_id','session_id'].every(name=>partColumns.has(name)))throw new Error('unsupported_opencode_database_schema');

  db.exec('PRAGMA busy_timeout = 1000; BEGIN IMMEDIATE');
  try{
   const select=db.prepare('SELECT id,directory,project_id FROM session WHERE id=?');
   const prior=select.get(options.sessionId) as {id:string;directory:string;project_id:string}|undefined;
   if(!prior)throw new Error('opencode_session_not_found_in_private_database');
   if(prior.directory===cwd){db.exec('COMMIT');return 'unchanged';}
   if(prior.directory!==home)throw new Error('opencode_session_has_unexpected_legacy_directory');
   const result=db.prepare('UPDATE session SET directory=? WHERE id=? AND directory=?').run(cwd,options.sessionId,home);
   if(Number(result.changes)!==1)throw new Error('opencode_session_directory_changed');
   const updated=select.get(options.sessionId) as {id:string;directory:string;project_id:string}|undefined;
   if(!updated||updated.id!==prior.id||updated.directory!==cwd||updated.project_id!==prior.project_id)throw new Error('opencode_session_relocation_verification_failed');
   db.exec('COMMIT');
   return 'relocated';
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 }finally{db.close();}
}
