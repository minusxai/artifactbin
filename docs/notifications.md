# Relations, events and notifications

## State and history

`relations` owns user→artefact likes and joins and user→user follows. A pair has
one row keyed by subject kind/ID, verb and object kind/ID. Its lifecycle is
`pending`, `accepted`, `dismissed` or `left`, with `direction` (`request` or
`invitation`), `initiated_by`, `accepted_at` and `revision`. `deleted_at` is set
for dismissed/left edges. Active reads require accepted status and no deletion.
Likes and follows are accepted immediately today; the lifecycle supports future
follow approval without another table. Join authorization remains in membership.
There is no membership table or legacy join/invitation migration.

Comments and resolution state remain in `annotations`; edits remain in
`artifact_edits`. Relations never replace those entity stores.

Notification-producing source actions call `recordEvent` in their transaction.
The existing event envelope enters `event_outbox`; central rules derive recipient
rows in `member_notifications` and link them by `source_event_id`. Their changed
messages enter the same outbox. Rollback loses neither half. The existing event
publisher persists facts in `events.events` and uses the delivery ledger for
retryable subscribers. No new activity store, bus or activity-feed UI is added.
Observational telemetry can still use best-effort `emit`.

A human's self-actions stay silent. Agent replies notify the human account even
when they share an identity. Replies notify the thread's participants and saved
mention recipients, excluding blocks. Reply plus resolution is one source event
and one conversation notification per recipient. Reopening is a new event.
Membership, comment and artefact access remain separate checks; inbox reads and
email eligibility recheck access rather than trusting an old event.

## One notification experience

The global provider owns the authenticated inbox and one live stream. The bell
uses the same exclusive panel controller and desktop/mobile surface as settings;
on artefacts it lives inside the existing trusted navigation boundary. Opening
settings/profile closes notifications, and pressing the bell toggles it.

The menu shows recent notifications and links to `/notifications` (history) and
`/account#notifications` (preferences only). Both inbox surfaces reuse the same
rows, invitation actions and revision-aware reading. Opening the menu observes
only its initial visible revisions: an update arriving later stays unread.
The live stream refreshes read, acceptance and removal state across tabs.

A comment link targets its thread and first unread comment, including resolved
history. Actually viewing the update marks that revision read; a collapsed marker
does not. A resolved open thread stays open. A collapsed resolved marker counts
10 visible seconds, pausing while hovered, focused, open, offscreen or backgrounded.
A new revision resets the timer; duplicate delivery does not. Reopening cancels
it. Expiry hides only the marker and never marks read or cancels email.
Agent pulse/status reuses remote work and presence, with reduced-motion support.

## Production email

OSS owns events, relations, inbox rules and UI. `artifactbin-server` owns email
preferences/storage, scheduling, templates, provider delivery and link tracking.
Invites are immediate; unread comment updates wait five minutes from the first
update; likes/follows form a daily digest. Access, verified identity, preferences
and unread eligibility are rechecked before sending.

Delivery uses the existing events subscriber ledger and Resend transport. Retry
payloads and idempotency keys are frozen; uncertain deliveries are held before
the provider's dedupe window expires. Stored destination links cannot grant
access, accept an invite or mark a notification read. Clicks are raw events,
not proof of human engagement. Sending defaults off pending controlled delivery
checks. Deployment and recovery instructions live in the server README.
