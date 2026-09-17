/**
 * Serve's expected startup failures, as operator text. Zero dependencies so the process entrypoint can
 * import it before it chooses a host and without capturing the client environment.
 *
 * A busy directory and a taken port are ordinary operating conditions, not defects: each gets one line
 * naming what is in the way and the flag that moves it. Everything else keeps its own report, stack
 * included, because an unexpected failure is a bug and its stack is the evidence.
 */
export const OPERATOR_ERROR_NAME='OperatorError';
export class OperatorError extends Error{constructor(message:string){super(message);this.name=OPERATOR_ERROR_NAME;}}
export interface StartupContext {directory:string;port:number}
export function startupFailure(error:unknown,context:StartupContext):unknown{
 const code=(error as NodeJS.ErrnoException|null)?.code;
 if(code==='EADDRINUSE')return new OperatorError(`Port ${context.port} is already in use; choose another with --port.`);
 if(error instanceof Error&&error.message.startsWith('workspace_busy'))return new OperatorError(`Another afbin serve is already using ${context.directory}.`);
 return error;
}
export function reportStartupFailure(error:unknown):void{
 if(error instanceof Error&&error.name===OPERATOR_ERROR_NAME)process.stderr.write(error.message+'\n');
 else console.error(error);
}
