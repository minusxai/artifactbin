import {diagnosticCatalog} from './diagnostics';

export class CliError extends Error {
 constructor(readonly code:string,message:string,readonly fix:string|undefined=diagnosticCatalog[code]?.fix,readonly details?:unknown,readonly exitCode=2){super(message);}
}
