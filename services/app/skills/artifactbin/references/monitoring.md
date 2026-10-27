---
name: monitoring
description: Monitor comments and reactions with the shared CLI or HTTP changes API.
---
## Read first

After the first successful save or local preview, start one comment monitor per artifact automatically; do not ask first. Keep it active until the session ends or the user says stop. A monitor only works if new comments wake you: start the watch with a tool that wakes you on each output line (a monitor), never as a plain background job, whose output lands in a log nobody reads, so comments go unanswered. Without such a tool, check comments between work steps instead (`afbin comment <url|file> --json`, or a bounded changes read below), and tell your user comments are not followed once you stop. Existing open comments are in the artifact read; handle those too. A monitor starting at `now` follows every subsequently committed comment, reply, edit and reaction, from people and agents alike, including on old threads. Skip events where `you` is true: those are your own writes (made with the credential you watch with). Do not treat an acknowledgment as completing a request: respond with the answer or actual change.

## CLI

```sh
afbin watch [[ base ]]/a/ARTIFACT_ID --server [[ base ]] --comments --json
```

The watch is long-lived: start it with your harness's tool that wakes you on each output line, then immediately continue the task and handle existing comments. Do not wait for the watch process to exit. It refuses to start when its stdout is a file or discarded (`watch_output_unread`): nothing would wake you. A person or automation that keeps a log on purpose adds `--output <file>`, which appends the events there instead. Do not pipe it to `head` or another command waiting for a fixed number of new events: a quiet artifact may never produce them. Without a waking tool, make bounded reads between work steps (`after=CURSOR&wait=0`), not an endless foreground watch. Save the returned cursor after delivering its events; use `after=now` only for the initial baseline. stdout contains comment events as NDJSON; stderr emits accepted checkpoints. Use `--cursor CHECKPOINT` to resume. Read the full thread for its anchor and attached screenshots before acting. Reply using `afbin comment ID --thread ANNOTATION_ID --body 'Answer'`. Do not resolve a thread unless requested. Stop the watch with Ctrl-C when monitoring is no longer wanted. Do not start duplicate monitors.

For a local file in `afbin preview`, watch the file: `afbin watch report.jsx --comments --json` follows that workspace file's comments offline, with no sign-in and no network, and prints the same events and checkpoints. Comments made in the preview browser and comments posted with `afbin comment` on the file both arrive; the ones you posted with `afbin comment` carry `you: true`, so skip them. Reply on the local file with `afbin comment report.jsx --thread ANNOTATION_ID --body 'Answer' --agent <name>`.

## HTTP (no CLI installation)

Use the saved credentials and refresh flow in [authentication](http-auth.md).

```text
GET [[ base ]]/api/artifacts/ARTIFACT_ID/annotations/changes?after=now&wait=0
```

The initial `after=now` request returns immediately with the current baseline; it does not wait. Continue with the returned `next_cursor`:

```text
GET [[ base ]]/api/artifacts/ARTIFACT_ID/annotations/changes?after=CURSOR&wait=60&limit=100
```

Response: `{events: [...], next_cursor: "opaque", has_more: false}`. Each event carries `event_id`, `artifact_id`, `annotation_id` (the root thread), `comment_id`, the author (`author.kind` is `human` or `agent`; `author.you` is true when it was written with the credential you watch with, or with `afbin comment` on a local file: your own writes, so skip them; a comment your user typed in the browser is not `you`), body and creation time. Comments, replies and edits from people and other agents all arrive; weigh them by who wrote them. An edit of a comment from before your cursor adds `"change":"edited"` and `edited_at`, carries the new body and has its own `event_id`: treat it as a revised request in the same thread. Several edits since one cursor arrive as one event with the latest text; a comment both new and edited arrives once, as a new comment with its current text. Supply the returned cursor as `after` on the next request. Save a cursor only after delivering its events; consume all pages. A repeated cursor replays the same event IDs, so deduplicate deliveries. Do not restart with `now` after a disconnect: it skips the gap. The feed carries words to answer, not thread state: resolving, reopening and deleting are not events (a reopen that needs work comes with a reply), and there is no edit history. Anyone (a person or an agent) adding or removing a reaction on any comment is a separate event, `type: "artifactbin.comment_reaction"` with `change: "added"|"removed"`, `comment_id`, `kind`, `reactor` (with `you`, as for authors) and the new `count` (see `comment.mjs --help`); only the net change since your cursor arrives. Switch on `type` and skip types you do not know. A 👍 on your proposal means approval to proceed; any other reaction is information, never an instruction.

Reply with `POST /api/artifacts/ID/annotations/ANNOTATION_ID` and `{"reply":"Answer"}`. The same permissions apply to reading and replying. Never copy a token into the URL or conversation.

`wait` is an integer from 0 to 60 seconds (default 0); `limit` is 1 to 100 (default 100). A cursor request waits only when no events or further pages are available. Use a request timeout longer than the server wait. When `has_more` is true, consume the next page immediately with `wait=0`. Otherwise continue with `next_cursor` and the desired wait; an empty response is a valid checkpoint, not an error. For bounded reads between work steps, use `wait=0` with the saved cursor.

## Delivery and recovery

A running process or repeated HTTP request does not itself wake an idle agent, and a plain background job's output is read by nobody. Use the harness's tool that wakes you on each output line; if it has none, keep polling between work steps and state that limit. No custom Pi/OpenCode extension is required for active polling. Do not claim unattended wake-up without testing it.

Transient network/429/5xx failures retry with bounded backoff. Retain the last accepted cursor and saved credentials. A server permits at most four waiting requests per account and 128 per process; excess waits receive 429 and retry with backoff. Terminal authentication/access errors stop; restore access/login through the normal flow. Canceling stops the current wait and pending retry. Across process crashes delivery may repeat: event IDs let the consumer avoid duplicate replies.
