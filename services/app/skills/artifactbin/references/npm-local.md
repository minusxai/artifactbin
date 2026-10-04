---
name: npm-local
description: Install Node and run afbin through npm, including prepared offline use.
---
## Installation and local files

- Prepare Node/npm once: `afbin_node_setup="$(mktemp)" && curl -fsSL [[ base ]]/chat/ensure-node.sh -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"`. Supported Node is reused; otherwise official LTS is installed for your user.
- Windows PowerShell: `Invoke-RestMethod [[ base ]]/chat/ensure-node.ps1 | Invoke-Expression`; use `npx.cmd` instead of `npx` below. No execution-policy change.
- Run every command through `npx --yes @artifactbin/cli@latest <command>`. Install skills with `npx --yes @artifactbin/cli@latest setup`. Pin an exact version for reproducibility. Prepare its npm cache while connected, then run `npm exec --offline --yes --package @artifactbin/cli@<version> -- afbin <command>` offline. npm executes with your permissions; it is not a sandbox.
- Local preview needs no credentials or cloud requests: `npx --yes @artifactbin/cli@latest preview report.jsx`. Source stays `.jsx`; offline downloads and HTML exports are self-contained `.jsx.html` files that open normally in a browser. Browser offline editing supports static markup/text; use local preview for compiler-dependent widgets. Publishing is explicit.
- CLI browser sign-in allows guests. Direct HTTP API sign-in requires email and cannot continue as a guest.
- Command examples below use `afbin` as shorthand: always invoke them as `npx --yes @artifactbin/cli@latest <command>` (Windows: `npx.cmd`).

The CLI uses browser approval or email sign-in for remote work. Direct HTTP clients require email authentication. Local preview remains local until explicit publication.
