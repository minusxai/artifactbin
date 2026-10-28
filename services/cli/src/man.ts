import {diagnosticsHelp} from './diagnostics';
import {commands,commandHelp} from './commands';
/** Roff uses \e for a literal backslash and \& to prevent a leading request.
 * Encode each input character once so generated escapes are never re-escaped.
 */
export function roffLiteral(value:string):string{
 return value.replace(/\\|^[.']|-/gm,character=>character==='\\'?'\\e':character==='-'?'\\-':'\\&'+character);
}
/** Render the parser's actual vocabulary as a portable roff manual; a command name narrows it. */
export function manPage(name?:string):string{
 const selected=name?commands.filter(command=>command.name===name||command.aliases?.includes(name)):commands;
 return '.TH AFBIN 1\n.SH NAME\nafbin \\- local files and published artifacts\n.SH SYNOPSIS\n.nf\n'+roffLiteral(commandHelp(name))+'\n.fi\n'+selected.map(command=>`.SH ${command.name.toUpperCase()}\n.nf\n${roffLiteral(commandHelp(command.name))}\n.fi\n`).join('')+'\n.SH ERRORS AND RECOVERY\n.nf\n'+roffLiteral(diagnosticsHelp())+'\n.fi\n';
}
