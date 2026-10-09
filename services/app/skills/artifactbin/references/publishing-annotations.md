---
name: publishing-annotations
description: "Rules and invocations for publishing annotations."
---
## Read first

Use the artifact reference consistently. New threads use exactly one node ID or quote. An ambiguous quote is refused; use the returned current node IDs. Replies name a thread on the same artifact. Pagination applies only to listing. Agents: include --agent <your-agent-name> when posting or replying, for example --agent codex, --agent claude-code, or --agent pi. Custom names are accepted and use a generic icon; the flag is optional for backward compatibility. This declares the agent software, not a connected session name, and grants no permissions.

## Inspect comment screenshots

Read the thread with afbin comment <artifact> --json (follow next_cursor if needed). For each attached image.id relevant to the request, after acknowledging run afbin comment <artifact> --image <image-id> --output <fresh-workspace-path>.webp --json, then open the returned path with your image viewing tool before answering. The default preview includes drawn marks; --variant original omits them. This downloads the saved capture, not a new rendering of the document. Use this authenticated CLI download for image bytes; metadata URLs are browser-session endpoints. If download fails or your model cannot inspect images, reply blocked and state the limitation; never describe unseen pixels from the snippet or surrounding document.

Comments are sidecar relations to the node's persistent BODY `id`; reading or writing a comment does not rewrite source or flush the editor. Legacy data-annotation-anchor attributes are preservation-only: preserve an existing value with its element; never author, change or reuse one. New comments do not add it.

Listing a document returns its OPEN threads only. Read the ones already settled with `afbin comment <ref> --filter state=resolved`, or both lists at once with `--filter state=all`.

"snippet" is the current node text. "quote" is the selected text; quote_found says whether it is still present. Comment Markdown supports links and emphasis: `![alt](url)` is not an image, but a literal exclamation mark plus a link. A comment cannot embed a picture. A deleted thread is not erased; there is no undo for it here.

Bearer requests retain their account attribution.
