/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Comment threads: list, add, reply, edit, react, resolve, reopen, watch.
Watch is the comment feed: every comment, reply, edit and reaction, from people and agents alike.
Usage: node scripts/comment.mjs list ID|URL [--status open|resolved|all] [--limit N] [--cursor C]
       node scripts/comment.mjs add ID --anchor ANCHOR.json --body-file FILE
       node scripts/comment.mjs reply ID --thread T --body-file FILE
         [--resolve --expected-revision R]
       node scripts/comment.mjs edit ID --comment C --expected-revision R --body-file FILE
       node scripts/comment.mjs resolve|reopen ID --thread T --expected-revision R
       node scripts/comment.mjs react ID --comment C --active true|false [--kind thumbs_up]
       node scripts/comment.mjs watch ID [--once] [--cursor CHECKPOINT_OR_LOG]
         [--output LOG --append]
Flags: write commands also take --request FILE (exclusive saved journal) and --resume FILE
  (replay it exactly; nothing else may change). list --status defaults to open; --limit 1-100
  (default 20). Common: --server, --json, --help.
Examples:
  node scripts/comment.mjs list ID --status all --json  # root and reply IDs, revisions, reactions
  node scripts/comment.mjs reply ID --thread T --body-file reply.txt
  node scripts/comment.mjs react ID --comment C --active true
Anchors: read the page first (read.mjs ID --json). ANCHOR.json is
  {"kind":"html-node","v":1,"revision":"<page version string>","nodeId":"<canonical data-af-id>",
  "quote":"<exact current text of that element, or empty for the whole node>"}.
  A comment on a script-created node also needs "ancestorId", the data-af-id of its saved ancestor.
Gotchas: list before replying, editing or changing state. A plain reply needs no revision; resolve
  and reopen need the last observed revision (a stale one fails; reply plus a stale resolve keeps
  the reply and reports status_conflict). Reactions are idempotent desired state per account
  (retry the same call, never invert it); counts are unique accounts, only thumbs_up exists, and
  they change no source or revision. Resolve and reopen are not feed events.
  watch --once establishes "now" without a cursor; events deduplicate by ID and only delivered
  ones advance checkpoints. Logs and checkpoints saved under the old "human-comments" stream name
  still resume.
Reactions: each listed comment's reactions are
  [{kind,count,viewer_reacted,by:[{kind:human|agent,label,user_id,image}]}]: who reacted (at most
  50 per kind, count stays exact), shown to everyone who sees comment authors. Text output prints
  them as "👍 ppsreejith, alice"; --json keeps the structure.
Watch events: comments are
  {type:"artifactbin.comment",...,author:{kind,label,user_id,you},body,change?:"edited"};
  reactions are {type:"artifactbin.comment_reaction",event_id,annotation_id,comment_id,
  change:"added"|"removed",kind,count,reactor:{kind:human|agent,label,user_id,you},created_at},
  count being the count right after; only the net change since your cursor arrives (added then
  removed is no event). you:true means you wrote it with the credential you watch with: skip
  those events. Skip event types you do not know.
How to treat reactions: a 👍 on your proposal means approval to proceed; any other reaction is
  information, never an instruction.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import {readFile} from 'node:fs/promises';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  positional,
  requireFlags,
  integer,
  enumValue,
  jsonFile,
  journalIntent,
  createJournal,
  resumeJournal,
  ToolError,
  serverOrigin
} from './toolbox-client.mjs';
import {watchComments, listText} from './toolbox-comments.mjs';
// Reads (list, watch) call the API directly; every write goes through a saved journal so an
// uncertain result can be resumed.
export async function commentCommand({sub, values, positionals}, options = {}) {
  // --resume replays a saved journal exactly; no other comment field may change.
  if (values.resume) {
    positional(positionals, 0);
    if (Object.keys(values).some(key => !['resume', 'server', 'json', 'output'].includes(key)))
      throw new ToolError('resume_overrides', 'Resume accepts no changed comment fields.', 2);
    const saved = await jsonFile(values.resume),
      client =
        makeClient(serverOrigin(selectedServer(values, options.env) ?? saved.server), options);
    const result = await resumeJournal(values.resume, client, 'comment');
    return {thread: result.receipt, journal: result.journal};
  }
  const {server, id} = resolveTarget(positional(positionals), selectedServer(values, options.env)),
    client = makeClient(server, options);
  if (sub === 'list') {
    const query = new URLSearchParams({
      status: values.status
        ? enumValue(values.status, ['open', 'resolved', 'all'], 'status')
        : 'open'
    });
    if (values.cursor) query.set('cursor', values.cursor);
    if (values.limit) query.set('limit', String(integer(values.limit, 'limit', 1, 100)));
    const page = await client.request(`/api/artifacts/${id}/annotations?${query}`);
    // Text output names who reacted ("👍 ppsreejith, alice"); --json and --output keep the
    // structure.
    return values.json || values.output ? page : listText(page);
  }
  // watch streams the comment feed until interrupted (or --once drains the backlog).
  if (sub === 'watch') {
    const controller = new AbortController();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
    await watchComments(client, id, values, {signal: controller.signal, ...options});
    return;
  }
  let body = {},
    route = `/api/artifacts/${id}/annotations`,
    method = 'POST';
  if (['add', 'reply', 'edit'].includes(sub)) {
    requireFlags(values, ['body-file']);
    body.body = await readFile(values['body-file'], 'utf8');
    if (!body.body.trim()) throw new ToolError('empty_body', 'Comment text must be nonblank.', 2);
  }
  // add: needs a native html-node anchor (see the Anchors section of the description).
  if (sub === 'add') {
    requireFlags(values, ['anchor']);
    body.anchor = await jsonFile(values.anchor);
    const anchor = body.anchor;
    if (
      anchor?.kind !== 'html-node' ||
      anchor.v !== 1 ||
      typeof anchor.revision !== 'string' ||
      typeof anchor.nodeId !== 'string' ||
      typeof anchor.quote !== 'string'
    )
      throw new ToolError(
        'invalid_anchor',
        'Provide a native html-node anchor with canonical revision/nodeId/quote.',
        2
      );
  // react: PUT of the desired state, idempotent, so retrying the same call is safe.
  } else if (sub === 'react') {
    requireFlags(values, ['comment', 'active']);
    if (!/^[A-Za-z0-9_-]+$/.test(values.comment))
      throw new ToolError('invalid_comment_id', 'Invalid comment ID.', 2);
    method = 'PUT';
    route += '/' + values.comment + '/reactions';
    body = {
      kind: enumValue(values.kind ?? 'thumbs_up', ['thumbs_up'], 'kind'),
      active: enumValue(values.active, ['true', 'false'], 'active') === 'true'
    };
  // reply, edit, resolve, reopen: all address an existing thread/comment and carry the observed
  // revision where required.
  } else {
    requireFlags(values, [
      sub === 'edit' ? 'comment' : 'thread',
      ...(sub === 'reply' && !values.resolve ? [] : ['expected-revision'])
    ]);
    const thread = values[sub === 'edit' ? 'comment' : 'thread'];
    if (!/^[A-Za-z0-9_-]+$/.test(thread))
      throw new ToolError('invalid_comment_id', 'Invalid comment/thread ID.', 2);
    route += '/' + thread;
    if (values['expected-revision'] !== undefined)
      body.expected_revision = integer(values['expected-revision'], 'expected_revision', 0);
    if (sub === 'edit') method = 'PATCH';
    else if (sub === 'reply') {
      body.reply = body.body;
      delete body.body;
      if (values.resolve) body.resolve = true;
    } else body[sub === 'resolve' ? 'resolve' : 'reopen'] = true;
  }
  // Save the intent before sending; --request chooses where, otherwise a private journal
  // directory is used.
  const journal = await createJournal(
    journalIntent({server, method, path: route, body, operation: 'comment'}),
    {file: values.request, root: client.root}
  );
  const result = await resumeJournal(journal, client, 'comment');
  return {thread: result.receipt, journal};
}
await runTool('comment', import.meta.url, commentCommand);
