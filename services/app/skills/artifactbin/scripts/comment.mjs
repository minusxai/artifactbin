/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Comment threads: list, add, reply, edit, react, resolve, reopen, watch.
Watch is the comment feed: every comment, reply, edit and reaction, from people and agents alike.
Usage: node scripts/comment.mjs watch ID --next
       node scripts/comment.mjs reply ID --thread T --body TEXT [--resolve]
       node scripts/comment.mjs list ID|URL [--status open|resolved|all] [--limit N] [--cursor C]
       node scripts/comment.mjs add ID --anchor ANCHOR.json --body TEXT
       node scripts/comment.mjs edit ID --comment C --body TEXT
       node scripts/comment.mjs resolve|reopen ID --thread T
       node scripts/comment.mjs react ID --comment C --active true|false [--kind thumbs_up]
       node scripts/comment.mjs watch ID [--once] [--cursor CHECKPOINT_OR_LOG]
         [--output LOG --append]
Flags: --body TEXT the comment text, inline; --body-file FILE reads it from a file instead.
  --expected-revision R (resolve, reopen, edit, reply --resolve) the thread revision you read;
  omitted, the command reads the thread's current revision itself. Write commands also take
  --request FILE (exclusive saved journal) and --resume FILE (replay it exactly; nothing else may
  change). list --status defaults to open; --limit 1-100 (default 20); watch --wait SECONDS
  (default 240; at least 60 with --next). Common: --server, --json, --help. --as NAME: the name
  your comments show, kept for this agent session (default: your product and a colour, such as
  "Claude Code Red"; ARTIFACTBIN_AGENT_NAME also sets it). add, reply, edit and react print the
  name, then the watch to run: they ask for answers, so watch for them.
Watch --next: Claude Code: start it with the Bash tool's run_in_background first, then send your
  reply as your last message and end your turn; you are woken when it prints. Other harnesses:
  in one turn, say your reply to the user (the page link first; a reply form the user set, such
  as just the link, is what you say), then call the watch: the words before a tool call are your
  reply, and nothing after the call may be read, since the session can end while it waits. Run
  it in the foreground with its default wait and a shell timeout of at least 300000 ms. It
  returns as soon as someone comments, and on its own within 4 minutes: handle what it printed
  and run it again until it says to stop watching. Watching is part of every task, however short
  the reply. It prints the next comments from someone else (one JSON line each; a first call also
  prints threads still waiting for your answer) and exits 0. After 4 minutes it prints "no new
  comments yet: run the same watch --next command again".
  After 15 minutes with no comment, reply or publish from anyone it prints "no new comments for
  15 minutes: stop watching and end your turn"; a later --next starts a new 15 minutes. A
  second --next of this agent session on the same page takes over from the running one, which
  stops; another agent's watch runs on. It resumes from watch/<server>/ID/<session>.ndjson in the
  sign-in folder (ARTIFACTBIN_HOME or ~/.artifactbin), or the --output LOG --append / --cursor.
Examples:
  node scripts/comment.mjs watch ID --next
  node scripts/comment.mjs reply ID --thread T --body "Done: the intro is two lines now."
  node scripts/comment.mjs list ID --status all --json  # root and reply IDs, revisions, reactions
  node scripts/comment.mjs react ID --comment C --active true
Anchors: read the page first (read.mjs ID --json). ANCHOR.json is
  {"kind":"html-node","v":1,"revision":"<page version number>","nodeId":"<canonical data-af-id>",
  "quote":"<exact current text of that element, or empty for the whole node>"}.
  Omit "revision" and this command fills it from the page's current version; supply one only
  from read.mjs (the version number, never the state hash or edit ID).
  A comment on a script-created node also needs "ancestorId", the data-af-id of its saved ancestor.
Gotchas: a plain reply never conflicts; a stale --expected-revision fails resolve and reopen (reply
  plus a stale resolve keeps the reply and reports status_conflict). Reactions are idempotent
  desired state per account (retry the same call, never invert it); counts are unique accounts,
  only thumbs_up exists, and they change no source or revision. Resolve and reopen are not feed
  events. watch --once sets "now" without a cursor; events deduplicate by ID and only delivered
  ones advance checkpoints.
Reactions: each listed comment's reactions are
  [{kind,count,viewer_reacted,by:[{kind:human|agent,label,user_id,image}]}]: who reacted (at most
  50 per kind, count stays exact), shown to everyone who sees comment authors. Text output prints
  them as "👍 ppsreejith, alice"; --json keeps the structure.
Watch events: comments are
  {type:"artifactbin.comment",...,author:{kind,label,user_id,you},body,change?:"edited"};
  reactions are {type:"artifactbin.comment_reaction",event_id,annotation_id,comment_id,
  change:"added"|"removed",kind,count,reactor:{kind:human|agent,label,user_id,you},created_at},
  count being the count right after; only the net change since your cursor arrives (added then
  removed is no event). you:true means this agent session wrote it (another agent on your
  sign-in is not you): skip those events. Skip event types you do not know.
How to treat reactions: a 👍 on your proposal means approval to proceed; any other reaction is
  information, never an instruction.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {runTool, resolveTarget, selectedServer, makeClient, positional, requireFlags, integer,
  enumValue, jsonFile, journalIntent, createJournal, resumeJournal, ToolError, serverOrigin,
  credentialRoot} from './toolbox-client.mjs';
import {watchComments, listText, watchLogPath} from './toolbox-comments.mjs';
import {watchNext} from './toolbox-watch-state.mjs';
import {commentText, threadRevision} from './toolbox-comment-write.mjs';
import {agentIdentity, nameNote} from './toolbox-agent.mjs';
// The writes that make something for others to answer: each prints the name and the watch next.
const ANSWERED = ['add', 'reply', 'edit', 'react'];
// Reads (list, watch) call the API directly; every write goes through a saved journal so an
// uncertain result can be resumed.
export async function commentCommand({sub, values, positionals}, options = {}) {
  // This agent session's name and key ride on every request; a write or --as keeps the name for
  // the session.
  const save = values.as !== undefined || !['list', 'watch'].includes(sub),
    identity = options.identity ??
      agentIdentity({env: options.env, as: values.as, root: credentialRoot(options.env), save});
  options = {...options, identity};
  // --resume replays a saved journal exactly; no other comment field may change.
  if (values.resume) {
    positional(positionals, 0);
    const allowed = ['resume', 'server', 'json', 'output', 'as'];
    if (Object.keys(values).some(key => !allowed.includes(key)))
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
    const query = new URLSearchParams({status: values.status
      ? enumValue(values.status, ['open', 'resolved', 'all'], 'status') : 'open'});
    if (values.cursor) query.set('cursor', values.cursor);
    if (values.limit) query.set('limit', String(integer(values.limit, 'limit', 1, 100)));
    const page = await client.request(`/api/artifacts/${id}/annotations?${query}`);
    // Text output names who reacted ("👍 ppsreejith, alice"); --json and --output keep the
    // structure.
    return values.json || values.output ? page : listText(page);
  }
  // watch streams comments (--once drains the backlog; --next returns after the next one); its
  // checkpoint lives beside the saved sign-in, so a loop that changes directory never rebaselines.
  if (sub === 'watch') {
    if (values.next && Number(values.wait ?? 240) < 60) throw new ToolError('wait_too_short',
      '--next waits for the next comment: drop --wait; it returns as soon as someone comments.', 2);
    const controller = new AbortController(), stop = () => controller.abort();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
    let watchValues = values;
    if (values.next && !values.output) {
      // An unidentified session (no key) keeps one shared log per page, as before sessions.
      const session = identity.session ?? 'shared',
        output = watchLogPath(credentialRoot(options.env), client.server, id, session);
      mkdirSync(path.dirname(output), {recursive: true, mode: 0o700});
      watchValues = {...values, output, append: existsSync(output)};
    }
    try {
      await watchComments(client, id, watchValues, {signal: controller.signal, ...options});
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, stop);
    }
    return;
  }
  let body = {}, route = `/api/artifacts/${id}/annotations`, method = 'POST';
  if (['add', 'reply', 'edit'].includes(sub)) body.body = await commentText(values);
  // add: needs a native html-node anchor (see the Anchors section of the description).
  if (sub === 'add') {
    requireFlags(values, ['anchor']);
    body.anchor = await jsonFile(values.anchor);
    const anchor = body.anchor;
    if (anchor?.kind === 'html-node' && anchor.revision === undefined) {
      const current = await client.request(`/api/artifacts/${id}`);
      if (Number.isSafeInteger(current?.version)) anchor.revision = String(current.version);
    }
    if (
      anchor?.kind !== 'html-node' ||
      anchor.v !== 1 ||
      typeof anchor.revision !== 'string' ||
      typeof anchor.nodeId !== 'string' ||
      typeof anchor.quote !== 'string'
    )
      throw new ToolError('invalid_anchor',
        'Provide a native html-node anchor with canonical revision/nodeId/quote.', 2);
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
  // reply, edit, resolve, reopen: all address an existing thread/comment; a state change or an
  // edit carries the thread revision, read here when --expected-revision is omitted.
  } else {
    requireFlags(values, [sub === 'edit' ? 'comment' : 'thread']);
    const thread = values[sub === 'edit' ? 'comment' : 'thread'];
    if (!/^[A-Za-z0-9_-]+$/.test(thread))
      throw new ToolError('invalid_comment_id', 'Invalid comment/thread ID.', 2);
    route += '/' + thread;
    if (values['expected-revision'] !== undefined)
      body.expected_revision = integer(values['expected-revision'], 'expected_revision', 0);
    else if (sub !== 'reply' || values.resolve)
      body.expected_revision = await threadRevision(client, id, thread);
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
  if (!ANSWERED.includes(sub)) return {thread: result.receipt, journal};
  // Answers come back as comments: the name it went out under, then the watch for them.
  return {thread: result.receipt, journal, agent: identity.name, note: nameNote(identity),
    next: watchNext(id)};
}
await runTool('comment', import.meta.url, commentCommand);
