/**
 * Strict argument parsing for the installed commands. Flag metadata (type, repeatable) lives here because the
 * parser needs it; everything a reader needs (purpose, usage, flags, examples, gotchas) lives in each script's
 * DESCRIPTION export, which --help prints and the SKILL.md command table is generated from. No text is duplicated.
 */
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';

// Flags every command accepts.
const shared = {
  help: flag('boolean'),
  json: flag('boolean'),
  server: flag(),
  output: flag()
};
function flag(type = 'string', multiple = false) {
  return {type, ...(multiple ? {multiple: true} : {})};
}

// Per command: positional verb(s) in `sub` (flags per subcommand) or plain `flags`; `listed:false` keeps a command out of the table.
const commands = {
  auth: {sub: {login: {email: flag(), challenge: flag(), 'code-file': flag()}, status: {}, logout: {}}},
  serve: {flags: {port: flag(), 'runtime-dir': flag(), autofix: flag('boolean')}},
  autofix: {listed: false, flags: {'dry-run': flag('boolean'), root: flag()}},
  publish: {
    flags: {
      type: flag(),
      root: flag(),
      manifest: flag(),
      title: flag(),
      visibility: flag(),
      'dry-run': flag('boolean'),
      strict: flag('boolean'),
      create: flag('boolean'),
      artifact: flag(),
      baseline: flag(),
      request: flag(),
      resume: flag()
    }
  },
  read: {flags: {version: flag()}, sub: {list: {cursor: flag(), limit: flag()}}},
  export: {flags: {format: flag(), slide: flag()}},
  check: {
    flags: {viewport: flag('string', true), steps: flag(), viewer: flag(), 'playwright-module': flag()}
  },
  graphql: {
    sub: {
      schema: {revision: flag()},
      query: {document: flag(), operation: flag(), variables: flag(), revision: flag()},
      mutate: {document: flag(), operation: flag(), variables: flag(), revision: flag()}
    }
  },
  comment: {
    sub: {
      list: {status: flag(), cursor: flag(), limit: flag()},
      add: {anchor: flag(), 'body-file': flag(), request: flag(), resume: flag()},
      reply: {
        thread: flag(),
        'expected-revision': flag(),
        'body-file': flag(),
        resolve: flag('boolean'),
        request: flag(),
        resume: flag()
      },
      edit: {
        comment: flag(),
        'expected-revision': flag(),
        'body-file': flag(),
        request: flag(),
        resume: flag()
      },
      resolve: {thread: flag(), 'expected-revision': flag(), request: flag(), resume: flag()},
      reopen: {thread: flag(), 'expected-revision': flag(), request: flag(), resume: flag()},
      react: {comment: flag(), kind: flag(), active: flag(), request: flag(), resume: flag()},
      watch: {cursor: flag(), once: flag('boolean'), append: flag('boolean')}
    }
  }
};
export const COMMANDS = Object.freeze(commands);

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
/** The SKILL.md command table, one row per listed command, generated from each DESCRIPTION. */
export function commandTable(read) {
  const rows = Object.entries(COMMANDS)
    .filter(([, spec]) => spec.listed !== false)
    .map(([name]) => {
      const {summary, example} = describe(name, read);
      return `| \`${example}\` | [${summary}](scripts/${name}.mjs) |`;
    });
  return ['| Command | Use |', '|---|---|', ...rows].join('\n');
}
export function parseCommand(name, args) {
  const command = COMMANDS[name];
  if (!command) throw Error('Unknown command');
  // The command verb is positional and must precede flags, except global offline --help.
  const sub = command.sub && Object.hasOwn(command.sub, args[0]) ? args[0] : undefined;
  if (command.sub && !sub && !['read'].includes(name) && !args.includes('--help'))
    throw Error('Choose a subcommand; see --help.');
  const flags = {...shared, ...(sub ? command.sub[sub] : command.flags)};
  const options = Object.fromEntries(
    Object.entries(flags).map(([key, {type, multiple}]) => [
      key,
      {type, ...(multiple ? {multiple: true} : {})}
    ])
  );
  const parsed = parseArgs({args: sub ? args.slice(1) : args, options, allowPositionals: true, strict: true});
  return {...parsed, sub};
}
