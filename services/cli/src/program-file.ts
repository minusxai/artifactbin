import {parseProgramDefinition,type ProgramDefinition} from '@artifactbin/contracts';
import {CliError} from './errors';
/** The compound extension distinguishes executable JSON from dataset row JSON. */
export const isProgramFile=(path:string):boolean=>path.toLowerCase().endsWith('.program.json');
export function programFileDefinition(bytes:Buffer,label:string):ProgramDefinition {
 try{return parseProgramDefinition(bytes.toString());}
 catch{throw new CliError('invalid_program',`${label} must contain a valid version: 1 program definition with a command array and non-secret configuration.`);}
}
export function programFileBytes(program:unknown):Buffer {
 const bytes=Buffer.from(JSON.stringify(program,null,2)+'\n');programFileDefinition(bytes,'Published program');return bytes;
}
