/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Events: watch what happens to what you may observe: comments on your
and shared pages.
Usage: node scripts/events.mjs watch [--artifact ID] [--category comments] [--types A,B] --next
       node scripts/events.mjs watch [filters] [--once] [--cursor CHECKPOINT_OR_LOG]
         [--output LOG --append]
Flags: --artifact ID one page's events. --category comments (artifact.annotated, annotation_replied,
  annotation_edited, annotation_resolved, annotation_reopened, annotation_deleted,
  annotation_reaction_changed).
  --types A,B exactly these types. --next returns after the next batch holding an event someone
  else made, and on its own after --wait SECONDS (default 240); it resumes from
  events/<server>/<ID or _all>/<stream>.<session>.ndjson in the sign-in folder. --bounded (with
  --next): after 15 minutes with no event it prints "stop watching"; without it a watch never
  stops on its own. --once drains what is waiting and exits. Common: --server, --json, --help.
Events: {id,position,type,at,schema_version,resource:{kind,id},actor:{kind,id,you},payload}.
  Payloads are ids and state, never text: read a comment's words with node scripts/comment.mjs
  list ID --status all --json. actor.you:true means this agent session made it (another agent on
  your sign-in is not you): --next logs those and never prints them. Delivery is at least once:
  skip an id you handled. A checkpoint is saved only after its events; an expired one (the feed
  keeps 30 days) starts again from now. Skip types you do not know.
Comments: node scripts/comment.mjs watch ID --next is this watch with --artifact ID --category
  comments --bounded, printing each comment with its words and the threads waiting for you.
Examples:
  node scripts/events.mjs watch --next
  node scripts/events.mjs watch --artifact PAGE12 --types artifact.annotation_resolved --once
Gotchas: a cursor belongs to its filter: change a filter and the watch starts from now on its
  own log. Reading the text of what an event names is a second read, checked again.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access. Results never contain credentials.`;

import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {runTool, selectedServer, makeClient, serverOrigin, credentialRoot, resolveTarget, ToolError}
  from './toolbox-client.mjs';
import {watchEvents, eventsPresenter, streamOf} from './toolbox-events.mjs';
import {watchLogPath} from './toolbox-watch-state.mjs';
import {agentIdentity} from './toolbox-agent.mjs';

/** events watch: the one watch over GET /api/events; comment.mjs watch is its comment alias. */
export async function eventsCommand({sub, values}, options = {}) {
  if (sub !== 'watch') throw new ToolError('invalid_invocation', 'Choose watch; see --help.', 2);
  if (values.next && Number(values.wait ?? 240) < 60) throw new ToolError('wait_too_short',
    '--next waits for the next event: drop --wait; it returns as soon as one arrives.', 2);
  if (values.bounded && !values.next) throw new ToolError('invalid_invocation',
    '--bounded applies to --next.', 2);
  // The agent session names every request, so the feed marks this session's own events `you`.
  const identity = options.identity ?? agentIdentity({env: options.env, root:
    credentialRoot(options.env), ps: options.ps});
  options = {...options, identity};
  const selected = selectedServer(values, options.env);
  const target = values.artifact ? resolveTarget(values.artifact, selected) : null;
  const client = makeClient(target?.server ?? serverOrigin(selected), options);
  const scope = {artifact: target?.id ?? null, category: values.category ?? null,
    types: values.types ?? null};
  let watchValues = values;
  if (values.next && !values.output) {
    const output = watchLogPath(credentialRoot(options.env), client.server, scope.artifact,
      streamOf(scope), identity.session ?? 'shared');
    mkdirSync(path.dirname(output), {recursive: true, mode: 0o700});
    watchValues = {...values, output, append: existsSync(output)};
  }
  const command = 'node scripts/events.mjs watch' +
    (scope.artifact ? ` --artifact ${scope.artifact}` : '') +
    (scope.category ? ` --category ${scope.category}` : '') +
    (scope.types ? ` --types ${scope.types}` : '');
  const controller = new AbortController(), stop = () => controller.abort();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  try {
    await watchEvents(client, scope, watchValues, {signal: controller.signal, ...options},
      eventsPresenter(command));
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, stop);
  }
}
await runTool('events', import.meta.url, eventsCommand);
