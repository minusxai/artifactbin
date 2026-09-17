# Artifact creation, guest users, and CLI connections

“Logged in” means logged in **in the browser**. CLI installation, CLI connection, and browser login are separate states.

## Ownership model

A guest is a user record with `is_guest = true`, no email, and no login identity. Artifacts and tokens use the existing `user_id` column:

```text
Guest user U
├── Browser credential → user_id U (remembered in an HttpOnly cookie)
├── CLI credential     → user_id U
└── Artifacts          → user_id U
```

Browser and CLI credentials are separate and independently revocable. They share ownership of existing and future artifacts. There is no artifact-grants table and no `owner_token_id` column.

A registered account uses the same ownership fields. Account-only pages still require a real login session. Being a guest user does not grant editing rights through unrelated public links.

## Browser first

The user clicks **Create artifact**, opens `/start`, and receives an artifact with editable instructions and a copy button. No login is required. The instructions tell the agent to install the CLI if necessary, connect to the artifact’s owner, and edit that same artifact.

| Browser | CLI state | What happens |
| --- | --- | --- |
| Logged in | Connected with access | Edit immediately; no additional approval. |
| Logged in | Installed, unconnected | Browser approval connects the CLI to the account. |
| Logged in | Not installed | Install without a separate login step, then approve the connection. |
| Logged in | Connected to another identity without access | Explicit approval switches the saved connection for this server to the browser’s account. |
| Guest | Connected to the same guest user | Edit immediately; no additional approval. |
| Guest | Installed, unconnected | Approve as a guest; issue a CLI credential for the browser’s guest user. |
| Guest | Not installed | Install, then approve as a guest in the original browser. |
| Guest | Connected to another identity without access | Explicit approval switches the CLI to the browser’s guest user. |

`afbin auth <artifact-url>` first checks existing edit access. If access is missing, it opens browser approval. The approval explains that the connection covers the owner’s artifacts, including future artifacts, and replaces a different saved connection for that server.

The artifact URL is not an ownership credential. A guest handoff must be approved in a browser holding that guest identity. An account-owned artifact can be approved after logging into its owning account.

When the agent writes the artifact, the open page updates live and dismisses the starter instructions.

## Agent first

The user asks an agent to make an artifact; there is no existing artifact yet.

| Browser | CLI state | What happens |
| --- | --- | --- |
| Any | Already connected | Create under the CLI’s current user. Browser login does not silently change it. |
| Logged in | Unconnected | Browser approval connects to the registered account, then the CLI creates the artifact. |
| Guest with an existing identity | Unconnected | Reuse that guest user during approval, then create the artifact. |
| No guest identity yet | Unconnected | Approval creates a guest user and browser cookie, issues the CLI credential, then the CLI creates the artifact. |
| Any | Not installed | Install, then follow the applicable connection flow above. Saved credentials from a previous installation may already exist. |

The same device approval supports interactive terminals and unattended agents. If the browser cannot open automatically, the CLI displays the approval URL.

## Returning to Create artifact after CLI approval

The browser already remembers the guest user established during approval. Clicking **Create artifact** creates another artifact under that same `user_id`. The CLI can edit it immediately. Conversely, the browser can see artifacts created by that CLI in its guest drafts.

Connections are scoped to a server. Connecting to one server does not connect the CLI to another.

## Logging in later

Email ownership must be verified before a merge. Entering an email or requesting an OTP does not merge anything.

After verified login, the app merges the cookie-held guest users into the authenticated account:

1. Transfer their artifacts to the account’s `user_id` without changing artifact URLs.
2. Transfer their approved CLI credentials to the account.
3. Preserve CLI access through subsequent credential refreshes.
4. Retain the emptied guest records only for historical attribution.

Both new registrations and existing accounts use this merge path. The login provider owns the registered account ID, so new registration also merges into that ID rather than trying to rename a guest into the provider’s identity.

**Approved guest agents become account agents:** their credentials gain normal access to the account’s other artifacts. The login screen explains this before verification.

Only guest users proven by live cookie-held credentials are merged. An unrelated guest or another registered account is not merged.

## Recovery and permission boundaries

| Situation | Behavior |
| --- | --- |
| Approval denied | Stop; retain any existing saved CLI connection. |
| Approval expires | Request another approval; do not create a replacement artifact. |
| Approval replayed | Refuse a second exchange. |
| Wrong browser or account | Refuse artifact-targeted approval; explain which browser/account is needed. |
| CLI credential expired | Refresh it, retaining the current user, including an account it was merged into. |
| CLI credential revoked | Require a new explicit connection approval. Other credentials remain valid. |
| Browser cookie lost | The public artifact URL cannot recover guest ownership. Existing CLI credentials continue to work. |
| User reloads the artifact | Reload the same artifact; do not create another. |
| Creation response lost | Do not automatically retry an uncertain creation. |

Bearer secrets never appear in artifact URLs, copied instructions, or browser JavaScript. Cookies contain signed credential IDs. Guest ownership does not imply a verified email or account session.

## Verification and evals

Focused tests cover browser-first and agent-first creation, shared future artifacts, credential refresh, independent revocation, verified account merge, and guest restrictions on unrelated artifacts. Broader regression and browser gates run in CI.

The existing agent evals distinguish installed/not-installed CLI and starter/hardcore prompts. Their driver creates and logs into a registered account; prompt difficulty does not make the run anonymous. Guest onboarding needs a separate eval fixture. Passing handler or browser checks is not a claim that this guest agent eval has run.
