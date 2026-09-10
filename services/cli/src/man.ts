import {diagnosticsHelp} from './diagnostics';
import {commands,commandHelp} from './commands';
/** Roff uses \e for a literal backslash and \& to prevent a leading request.
 * Encode each input character once so generated escapes are never re-escaped.
 */
export function roffLiteral(value:string):string{
 return value.replace(/\\|^[.']|-/gm,character=>character==='\\'?'\\e':character==='-'?'\\-':'\\&'+character);
}
/** Render the parser's actual vocabulary as a portable roff manual. */
export function manPage():string{
 return '.TH AFBIN 1\n.SH NAME\nafbin \\- local files and published artifacts\n.SH SYNOPSIS\n.nf\n'+roffLiteral(commandHelp())+'\n.fi\n'+commands.map(command=>`.SH ${command.name.toUpperCase()}\n.nf\n${roffLiteral(commandHelp(command.name))}\n.fi\n`).join('')+'\n.SH ERRORS AND RECOVERY\n.nf\n'+roffLiteral(diagnosticsHelp())+'\n.fi\n';
}
