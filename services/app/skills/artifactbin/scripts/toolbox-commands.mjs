/**
 * Internal: strict argument parsing for the installed commands. Flag metadata (type, repeatable)
 * lives here because the parser needs it; everything a reader needs (purpose, usage, flags,
 * examples, gotchas) lives in each script's DESCRIPTION export, which --help prints. SKILL.md's
 * Core flows quote real commands; a test checks them against these descriptions.
 * Used by: toolbox-client.mjs (runTool), toolbox-description.mjs, author-commands and
 *   author-toolbox tests.
 */
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

// Per command: positional verb(s) in `sub` (flags per subcommand) or plain `flags`;
// `listed:false` keeps a command out of the table; `starter` names the starter that routes it.
const commands = {
  auth: {sub: {
    login: {email: flag(), challenge: flag(), 'code-file': flag(), audience: flag()},
    status: {audience: flag()},
    logout: {local: flag('boolean'), audience: flag()}
  }},
  serve: {flags: {port: flag(), autofix: flag('boolean')}},
  autofix: {listed: false, flags: {'dry-run': flag('boolean'), root: flag()}},
  publish: {
    flags: {
      type: flag(),
      root: flag(),
      title: flag(),
      template: flag(),
      'owner-column': flag(),
      name: flag(),
      visibility: flag(),
      group: flag(),
      personal: flag('boolean'),
      'dry-run': flag('boolean'),
      strict: flag('boolean'),
      create: flag('boolean'),
      artifact: flag(),
      request: flag(),
      resume: flag()
    }
  },
  read: {flags: {version: flag()}, sub: {list: {cursor: flag(), limit: flag()}}},
  export: {flags: {format: flag(), slide: flag(), element: flag()}},
  check: {
    flags: {
      viewport: flag('string', true),
      steps: flag(),
      'guest-steps': flag(),
      'cleanup-steps': flag(),
      viewer: flag(),
      'playwright-module': flag()
    }
  },
  sql: {
    sub: {
      schema: {revision: flag()},
      query: {params: flag(), limit: flag(), revision: flag(), 'idempotency-key': flag()}
    }
  },
  groups: {sub: {
    list: {}, show: {pages: flag('boolean'), cursor: flag()},
    create: {name: flag(), description: flag(), parent: flag()},
    update: {name: flag(), description: flag()},
    reparent: {parent: flag(), root: flag('boolean'), yes: flag('boolean')},
    invite: {role: flag(), yes: flag('boolean')}, uninvite: {yes: flag('boolean')},
    role: {role: flag(), yes: flag('boolean')}, remove: {yes: flag('boolean')},
    leave: {yes: flag('boolean')}, share: {group: flag(), role: flag(), datasets: flag('boolean'),
      yes: flag('boolean')},
    unshare: {group: flag(), datasets: flag('boolean'), yes: flag('boolean')},
    move: {group: flag(), personal: flag('boolean'), yes: flag('boolean')},
    link: {}, unlink: {yes: flag('boolean')}, delete: {handle: flag(), yes: flag('boolean')}
  }},
  comment: {
    sub: {
      list: {status: flag(), cursor: flag(), limit: flag()},
      add: {anchor: flag(), body: flag(), 'body-file': flag(), request: flag(), resume: flag()},
      reply: {
        thread: flag(),
        'expected-revision': flag(),
        body: flag(),
        'body-file': flag(),
        resolve: flag('boolean'),
        request: flag(),
        resume: flag()
      },
      edit: {
        comment: flag(),
        'expected-revision': flag(),
        body: flag(),
        'body-file': flag(),
        request: flag(),
        resume: flag()
      },
      resolve: {thread: flag(), 'expected-revision': flag(), request: flag(), resume: flag()},
      reopen: {thread: flag(), 'expected-revision': flag(), request: flag(), resume: flag()},
      react: {comment: flag(), kind: flag(), active: flag(), request: flag(), resume: flag()},
      watch: {
        next: flag('boolean'),
        replied: flag('boolean'),
        wait: flag()
      }
    }
  },
  // The one events watch; comment.mjs watch is its comment alias.
  events: {sub: {watch: {
    artifact: flag(), category: flag(), types: flag(), next: flag('boolean'), wait: flag(),
    bounded: flag('boolean')
  }}},
  policy: {sub: {
    get: {}, explain: {}, template: {'owner-column': flag()},
    set: {file: flag(), 'dry-run': flag('boolean'), 'expected-revision': flag()}
  }},
  doc: {sub: {read: {region: flag(), html: flag('boolean')}, write: {}}},
  'new-app': {
    starter: 'examples/tracker.html',
    flags: {kind: flag(), title: flag(), preset: flag(), without: flag(), limit: flag(),
      url: flag(), dir: flag()}
  },
  'new-page': {
    starter: 'examples/csv-dashboard.html',
    flags: {title: flag(), data: flag(), dir: flag(), artifact: flag()}
  },
  'new-codebase-report': {
    starter: 'examples/codebase-report.html',
    flags: {title: flag(), repo: flag(), since: flag(), areas: flag(), dir: flag(),
      artifact: flag()}
  }
};
// --as NAME: the name this agent session's comments show (toolbox-agent), on every comment verb.
for (const flags of Object.values(commands.comment.sub)) flags.as = flag();
export const COMMANDS = Object.freeze(commands);

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
const parsed = parseArgs({args: sub ? args.slice(1) : args, options, allowPositionals: true, strict:
    true});
  return {...parsed, sub};
}
