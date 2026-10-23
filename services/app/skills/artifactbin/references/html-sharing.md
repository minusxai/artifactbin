---
name: html-sharing
description: Account identity, group destinations and original page and dataset permissions.
---
## Read first

Authenticate as the recipient with access. A shared URL never transfers the sender’s login. Public/unlisted readability is separate from ownership, editing, comments and dataset writes.

For a group destination, `GET /api/groups/HANDLE` resolves the group and verifies membership. Set an account default using `PUT /api/me/preferences` with `{"default_destination":{"type":"group","id":"<resolved group.id>"}}`. Personal uses `{"default_destination":{"type":"personal"}}`; inherit clears an account override with `{"default_destination":{"type":"inherit"}}`. Preferences belong to this account on this origin.

New artifacts use an explicit destination, otherwise the parent owner, account default, deployment default and then Personal. Conflicting explicit destination and parent ownership is refused. Changing a default never transfers existing artifacts. Group editors can publish/edit; viewers can read permitted artifacts. Deployment admission or an invitation can still be required.

Backend role directives use the original artifact role. A page link never grants dataset write access. Keep data policies and membership separate from whether the page is public. Read [backend permissions](html-backends.md) and [dataset writes](html-datasets.md) before building shared forms.

## Reader presence

The platform's Readers control shows other readers and owns five private browser preferences: Show me to other readers, Share my cursor, Share my selections, Show other cursors, and Show other selections. They default on. Hiding yourself suppresses your published presence geometry; sharing and displaying other readers are separate choices.

These preferences belong to the platform origin, not the authored page's Apollo state. Do not build another preference store, inject presence identities, or copy them into page source or downloads. Presence is ephemeral geometry scoped to a page revision, not shared application data; it does not transmit selected text or grant permissions. Stable node identities help the platform position cursors and selections. The platform manages its authenticated presence transport automatically.
