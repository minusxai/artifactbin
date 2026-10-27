/** --help text: each script's own DESCRIPTION export, read from its source. Kept apart from the parser (this file reads files). */
import {readFileSync} from 'node:fs';
import {COMMANDS} from './toolbox-commands.mjs';

/** The script's own DESCRIPTION text, read from its source (the script may not be imported: it runs its command on load). */
export function descriptionOf(
  name,
  read = file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
) {
  if (!COMMANDS[name]) throw Error('Unknown command');
  const match = /^export const DESCRIPTION = `([^`]*)`;$/m.exec(read(`${name}.mjs`));
  if (!match) throw Error(`${name}.mjs has no DESCRIPTION`);
  return match[1];
}
/** Parts of a DESCRIPTION that other surfaces reuse: the first line (summary) and the first example command. */
export function describe(name, read) {
  const text = descriptionOf(name, read);
  const example =
    /^Examples:\n\s+(node scripts\/\S+(?: (?!#)\S+)*)/m.exec(text)?.[1] ?? `node scripts/${name}.mjs`;
  return {summary: text.split('\n')[0], example};
}
/** --help prints the script's DESCRIPTION verbatim. */
export function commandHelp(name, read) {
  return descriptionOf(name, read) + '\n';
}
