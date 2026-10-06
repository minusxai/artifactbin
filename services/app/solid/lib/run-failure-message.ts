/** Human-facing run diagnostics; receipt reasons stay unchanged. */
const TIME_LIMIT_MESSAGE='The run reached its time limit. Shorten the command or increase its allowed runtime, then try again.';

export function runFailureMessage(reason:string):string{
 if(reason==='timeout'||reason==='deadline')return TIME_LIMIT_MESSAGE;
 const match=/^process_exit_(\d+)$/.exec(reason);
 if(match){
  const code=Number(match[1]);
  if(!Number.isSafeInteger(code))return reason;
  if(code===137)return `The process was terminated (exit code ${code}). Check its memory and time limits before trying again.`;
  return `The process exited with code ${code}. Check the command and its output before trying again.`;
 }
 return reason;
}
