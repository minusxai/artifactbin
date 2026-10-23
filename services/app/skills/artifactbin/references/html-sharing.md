---
name: html-sharing
description: Account identity, group destinations and original page and dataset permissions.
---
## Read first

Authenticate as the recipient with access. A shared URL never transfers the sender’s login. Public/unlisted readability is separate from ownership, editing, comments and dataset writes.

For a group destination, `GET /api/groups/HANDLE` resolves the group and verifies membership. Set an account default using `PUT /api/me/preferences` with `{"default_destination":{"type":"group","id":"<resolved group.id>"}}`. Personal uses `{"default_destination":{"type":"personal"}}`; inherit clears an account override with `{"default_destination":{"type":"inherit"}}`. Preferences belong to this account on this origin.

New artifacts use an explicit destination, otherwise the parent owner, account default, deployment default and then Personal. Conflicting explicit destination and parent ownership is refused. Changing a default never transfers existing artifacts. Group editors can publish/edit; viewers can read permitted artifacts. Deployment admission or an invitation can still be required.

Backend role directives use the original artifact role. A page link never grants dataset write access. Keep data policies and membership separate from whether the page is public. Read [backend permissions](html-backends.md) and [dataset writes](html-datasets.md) before building shared forms.
