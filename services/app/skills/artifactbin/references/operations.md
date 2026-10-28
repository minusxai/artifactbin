---
name: operations
description: Publishing, querying, commenting and exporting invocation discovery.
---
## Read first

`afbin -h` lists commands; `afbin <command> -h` gives exact flags. [Commands](commands.md) distinguishes local capabilities from HTTP. For HTTP use [API](http-api.md), [authoring](http-authoring.md) and [graph fields](http-document-graph.md).

- Create/edit: `afbin push report.jsx`, or HTTP create/prepare/edits. Preserve identity and observed conditions.
- Query: `afbin query ID --name tasks`; mutations use declared named arguments.
- Comment: `afbin comment ID --agent codex` with the command's required body/anchor flags; preserve thread revisions.
- Export: `afbin export ID --output out.png`; use published URL or `--refresh` for current server data. See [history and export](publishing-versions.md).

Public links grant reading according to visibility; they do not grant edit access or dataset writes. Authenticate as the recipient, then follow the permission and conflict response.
