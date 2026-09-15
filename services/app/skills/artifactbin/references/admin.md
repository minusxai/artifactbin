---
name: admin
description: Explicit administrative document inspection and source repair.
---
# Administrative document repair

Use only when explicitly authorized to administer the deployment. The server
requires your authenticated account's verified email in `ADMIN__EMAILS`.

```sh
afbin admin list mx.data
afbin admin pull abc123 --output repair.jsx
afbin admin push repair.jsx --reason "Repair legacy widget"
```

`admin list [text]` searches live document titles/source, 50 per page; pass the
returned `next` ID with `--cursor` to continue. `admin pull` requires a new file.
Edit source while preserving the YAML identity. `admin push` publishes a new
version, preserves ownership/sharing, and records your account and reason in the
audit. It does not change YAML metadata or register files for ordinary auto-push.
On `version_conflict`, keep the draft and pull the current head into another file.
After an uncertain write, inspect a new pull before retrying.

These commands explicitly enter the administrative API. They do not grant ordinary
commands, document scripts, dataset mutations, or browser sessions admin access.
An ordinary access refusal is not authorization to use administrative commands.
