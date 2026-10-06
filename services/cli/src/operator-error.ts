/**
 * Expected local-server startup failures, as operator text. Zero dependencies so the process entrypoint can
 * import it before it chooses a host and without capturing the client environment.
 *
 * A busy directory or taken port is an ordinary operating condition, not a defect. Translate each only
 * at the startup boundary that knows what owns it; everything else keeps its stack as evidence.
 */
export const OPERATOR_ERROR_NAME='OperatorError';
export class OperatorError extends Error{constructor(message:string){super(message);this.name=OPERATOR_ERROR_NAME;}}
/**
 * `started` flips once the listener is open. After that the translation is OFF: both conditions it
 * names can only happen while claiming the port and the directory, so a later EADDRINUSE or
 * `workspace_busy` is something else entirely and "choose another with --port" would misdirect. A
 * running server that fails is a bug, and the stack is the evidence.
 */
export interface StartupContext {directory:string;port:number;started?:boolean}
export function startupPortFailure(error:unknown,port:number):unknown{
 const code=(error as NodeJS.ErrnoException|null)?.code;
 if(code==='EADDRINUSE')return new OperatorError(`Port ${port} is already in use; choose another with --port.`);
 return error;
}
export function startupFailure(error:unknown,context:StartupContext):unknown{
 if(context.started)return error;
 const portFailure=startupPortFailure(error,context.port);
 if(portFailure!==error)return portFailure;
 if(error instanceof Error&&error.message.startsWith('workspace_busy'))return new OperatorError(`Another afbin serve is already using ${context.directory}.`);
 return error;
}
export function reportStartupFailure(error:unknown):void{
 if(error instanceof Error&&error.name===OPERATOR_ERROR_NAME)process.stderr.write(error.message+'\n');
 else console.error(error);
}
