---
name: npm-local
description: Install Node and run afbin through npm, including prepared offline use.
---
## Installation and local files

- Prepare Node/npm once: `afbin_node_setup="$(mktemp)" && curl -fsSL [[ base ]]/chat/ensure-node.sh -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"`. Supported Node is reused; otherwise official LTS is installed for your user.
- Windows PowerShell: `Invoke-RestMethod [[ base ]]/chat/ensure-node.ps1 | Invoke-Expression`; use `npx.cmd` instead of `npx` below. No execution-policy change.
- Run every command through `npx --yes @afbin/cli@latest <command>`. Install skills with `npx --yes @afbin/cli@latest setup`. Pin an exact version for reproducibility. Prepare its npm cache while connected, then run `npm exec --offline --yes --package @afbin/cli@<version> -- afbin <command>` offline. npm executes with your permissions; it is not a sandbox.
- Local preview needs no credentials or cloud requests: `npx --yes @afbin/cli@latest preview report.jsx`. Source stays `.jsx`; offline downloads and HTML exports are self-contained `.jsx.html` files that open normally in a browser. Browser offline editing supports static markup/text; use local preview for compiler-dependent widgets. Publishing is explicit.
- CLI browser sign-in allows guests. Direct HTTP API sign-in requires email and cannot continue as a guest.
- Command examples below use `afbin` as shorthand: always invoke them as `npx --yes @afbin/cli@latest <command>` (Windows: `npx.cmd`).

The CLI uses browser approval or email sign-in for remote work. Direct HTTP clients require email authentication; see [HTTP API](http-api.md) for the email OTP and bearer flow without CLI installation. Local preview remains local until explicit publication.

## One local editing journey

Write `report.jsx`, then run each command through npm:

```sh
npx --yes @afbin/cli@latest preview report.jsx
npx --yes @afbin/cli@latest export report.jsx --format html
npx --yes @afbin/cli@latest import ID-SLUG.jsx.html --output report.jsx
npx --yes @afbin/cli@latest push report.jsx
```

Replace `ID-SLUG.jsx.html` with the filename printed by export.

Preview binds localhost and edits the source without sign-in or cloud requests. `--share` explicitly enables network access; anyone who can reach that server may edit. Close preview when finished.

HTML export defaults to `<artifact-id>-<URL-slug>.jsx.html`, a self-contained offline file that opens normally in a browser. Use the emitted filename, or pass `--output report.jsx.html` to choose an explicit name. Web downloads and browser Save use the same `.jsx.html` suffix. JSX source stays `.jsx`; PNG, CSV and other formats keep their own extensions. Save edits and comments from the offline browser before importing its downloaded file.

Import reads that HTML file locally. With no `--output`, the `.jsx.html` suffix becomes `.jsx` (legacy `.html` is also accepted). Use `--output revised.jsx` to choose another JSX destination. Existing local documents reconcile against their baseline; conflicts preserve copies instead of silently replacing your work. Tracked remote destinations are refused. Import has no `--force`, does not publish, and never writes to stdout.

Push is the explicit cloud publication step. It preserves remote identity and refuses conflicting remote changes. Browser approval in the CLI may continue as a guest; `auth --email <email>` is available for headless use. Direct HTTP clients require email authentication and cannot use guest browser approval.

Before disconnecting, cache an exact npm package version and prepare any required browser assets. Substitute that version in the offline command above for every local operation. npm packaging does not sandbox the CLI or guarantee that arbitrary commands avoid network access.

## Connect an offline copy

Start an empty local server with `npx --yes @afbin/cli@latest preview --port 7474`, then choose **Connect to server** in the HTML file and enter `http://localhost:7474`. Confirm the workspace import. This preserves the standalone file and does not publish. The local server uses the same editor and comments components as hosted artifactbin.

For an existing hosted artifact, enter its artifactbin HTTPS server origin instead. Sign in and explicitly apply to the recognized embedded ID. The existing JSONB update guards allow independent concurrent edits and refuse overlapping changes. An unknown or unauthorized ID never silently becomes a new artifact. Renaming the file does not change the ID stored inside it. Save remains a separate local action; connecting does not silently synchronize either copy.
