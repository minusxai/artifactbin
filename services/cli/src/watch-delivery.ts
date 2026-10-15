/**
 * WHERE A COMMENT WATCH'S EVENTS GO. `afbin watch` is worth running only while something reads each stdout line as it
 * arrives and acts on it: a harness tool that wakes the agent per line, a pipe into another program, a terminal. A
 * regular file or the null device is a log nobody is woken by: in the preview-then-monitor eval (2026-10-15) every run
 * that launched the watch as a plain background shell command, whose stdout is a file, left the person's comment
 * unanswered. Probed the same day, per harness tool: Claude Code's Monitor gives the process a socket and its Bash tool
 * (foreground and background) a regular file; Codex's shell gives a pipe, OpenCode's a socket, Pi's a pipe.
 *
 * So a watch whose stdout is a file or discarded refuses at once. Exiting is also the one thing a background shell
 * reports back to its agent, so the refusal is how that agent learns to start the watch the right way. A person or an
 * automation that keeps a log on purpose says so with `--output <file>`: events are appended to that file instead of
 * stdout, and nothing is refused. The same rule, in words, leads every `next` that names a watch.
 */
import {appendFileSync,fstatSync,statSync} from 'node:fs';
import {CliError} from './errors';

export type WatchOutput='stream'|'file'|'discarded';

/** What the process's stdout is: a stream something can read line by line, a regular file, or the null device. */
export function watchOutput(fd=1):WatchOutput{
 let out;try{out=fstatSync(fd);}catch{return 'stream';}
 if(out.isFile())return 'file';
 if(out.isCharacterDevice()&&process.platform!=='win32'){
  try{const nul=statSync('/dev/null');if(nul.rdev===out.rdev&&nul.ino===out.ino)return 'discarded';}catch{/* No /dev/null to compare with: not discarded. */}
 }
 return 'stream';
}

/** How a watch must be started, in one clause every hint shares. */
export const WATCH_DELIVERY='with a tool that wakes you on each output line (a monitor), not as a plain background job, whose output lands in a log nobody reads';

/** The fallback when the harness has no such tool: bounded reads between work steps, never a fire-and-forget job. */
export function watchFallback(ref:string):string{
 return `Without such a tool, check \`afbin comment ${ref} --json\` between work steps instead, and tell your user comments are not followed once you stop.`;
}

/** Refuses a watch nothing would be woken by, naming the right way to start it. */
export function refuseUnreadWatch(output:WatchOutput,ref:string):void{
 if(output==='stream')return;
 const where=output==='file'?'stdout here is a file':'stdout here is discarded';
 throw new CliError('watch_output_unread',`afbin watch writes each new comment to stdout, and ${where}: nothing wakes you when a comment arrives, so it would go unanswered.`,
  `Start \`afbin watch ${ref} --comments --json\` ${WATCH_DELIVERY}. ${watchFallback(ref)} To log events to a file on purpose, add --output <file>.`);
}

/** `--output <file>`: the deliberate log. Appends each event line to the file, created at once so a bad path fails before any wait. */
export function watchLog(path:string):(value:string)=>void{
 appendFileSync(path,'');
 return value=>appendFileSync(path,value);
}
