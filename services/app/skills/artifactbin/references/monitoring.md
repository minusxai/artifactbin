---
name: monitoring
description: Monitor human comments with the shared CLI or HTTP changes API.
---
## Read first

Use one monitor per artifact while working. Existing open comments are in the artifact read; handle those too. A monitor starting at `now` follows only subsequently committed human comments, replies and human edits of comments, including on old threads. It ignores agent replies and agent edits. Do not treat an acknowledgment as completing the human request: respond with the answer or actual change.

## CLI

```sh
afbin watch [[ base ]]/a/ARTIFACT_ID --server [[ base ]] --comments --json
```

The watch is long-lived: start it through your harness's background/monitor mechanism, then immediately continue the task and handle existing comments. Do not wait for the watch process to exit. Do not pipe it to `head` or another command waiting for a fixed number of new events: a quiet artifact may never produce them. If your harness cannot run background tools, make bounded HTTP changes reads between work steps (`after=CURSOR&wait=0`), not an endless foreground watch. Save the returned cursor after delivering its events; use `after=now` only for the initial baseline. stdout contains comment events as NDJSON; stderr emits accepted checkpoints. Use `--cursor CHECKPOINT` to resume. Read the full thread for its anchor and attached screenshots before acting. Reply using `afbin comment ID --thread ANNOTATION_ID --body 'Answer'`. Do not resolve a thread unless requested. Stop the watch with Ctrl-C when monitoring is no longer wanted. Do not start duplicate monitors.

## HTTP (no CLI installation)

Use the saved credentials and refresh flow in [authentication](http-auth.md).

```text
GET [[ base ]]/api/artifacts/ARTIFACT_ID/annotations/changes?after=now&wait=0
```

The initial `after=now` request returns immediately with the current baseline; it does not wait. Continue with the returned `next_cursor`:

```text
GET [[ base ]]/api/artifacts/ARTIFACT_ID/annotations/changes?after=CURSOR&wait=60&limit=100
```

Response: `{events: [...], next_cursor: "opaque", has_more: false}`. Each event carries `event_id`, `artifact_id`, `annotation_id` (the root thread), `comment_id`, human author, body and creation time. An edit of a comment from before your cursor adds `"change":"edited"` and `edited_at`, carries the new body and has its own `event_id`: treat it as a revised request in the same thread. Several edits since one cursor arrive as one event with the latest text; a comment both new and edited arrives once, as a new comment with its current text. Supply the returned cursor as `after` on the next request. Save a cursor only after delivering its events; consume all pages. A repeated cursor replays the same event IDs, so deduplicate deliveries. Do not restart with `now` after a disconnect: it skips the gap. The feed carries words to answer, not thread state: resolving, reopening and deleting are not events (a reopen that needs work comes with a reply), and there is no edit history.

Reply with `POST /api/artifacts/ID/annotations/ANNOTATION_ID` and `{"reply":"Answer"}`. The same permissions apply to reading and replying. Never copy a token into the URL or conversation.

`wait` is an integer from 0 to 60 seconds (default 0); `limit` is 1 to 100 (default 100). A cursor request waits only when no events or further pages are available. Use a request timeout longer than the server wait. When `has_more` is true, consume the next page immediately with `wait=0`. Otherwise continue with `next_cursor` and the desired wait; an empty response is a valid checkpoint, not an error. For bounded reads between work steps, use `wait=0` with the saved cursor.

## Delivery and recovery

A running process or repeated HTTP request does not itself wake an idle agent. Use the harness's supported delivery mechanism; if unavailable, keep an active polling task and state that limit. No custom Pi/OpenCode extension is required for active polling. Do not claim unattended wake-up without testing it.

Transient network/429/5xx failures retry with bounded backoff. Retain the last accepted cursor and saved credentials. A server permits at most four waiting requests per account and 128 per process; excess waits receive 429 and retry with backoff. Terminal authentication/access errors stop; restore access/login through the normal flow. Canceling stops the current wait and pending retry. Across process crashes delivery may repeat: event IDs let the consumer avoid duplicate replies.
