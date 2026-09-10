import {diagnosticsHelp} from './diagnostics';
import {commands,commandHelp} from './commands';
/** Render the parser's actual vocabulary as a portable roff manual. */
export function manPage():string{
 const literal=(value:string)=>value.replace(/\\/g,'\\e').replace(/^([.'])/gm,'\\&$1').replace(/-/g,'\\-');
 return '.TH AFBIN 1\n.SH NAME\nafbin \\- local files and published artifacts\n.SH SYNOPSIS\n.nf\n'+literal(commandHelp())+'\n.fi\n'+commands.map(command=>`.SH ${command.name.toUpperCase()}\n.nf\n${literal(commandHelp(command.name))}\n.fi\n`).join('')+'\n.SH ERRORS AND RECOVERY\n.nf\n'+literal(diagnosticsHelp())+'\n.fi\n';
}
