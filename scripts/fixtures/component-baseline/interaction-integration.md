# Paired interaction coverage

Import/spread `interactionBaselineFixtures` from `interaction.mjs` (index does this).
These add three fixtures and eight states, for 256 total captures at the existing
four theme/viewport combinations. Publication now produces56 pages plus one
upload dataset. The isolated publisher test must copy `interaction.mjs` with the
other fixture modules; both capture sources must use the same fixture bytes.

The gate's existing afterAction hook must call:

```js
await settleInteraction({fixture,action,frame:page,implementation:input.implementation});
```

Import `settleInteraction` from `../fixtures/component-baseline/interaction.mjs`.
Use the actual frame variable (currently `page` in the reader mount), not a parent
platform frame. It waits for the real old query page or native public source data
to settle before the real table scroll, then for the appended virtual cell1001.
The original uses its real1000-row SQLite display window and500-row paging door;
the candidate public caller-owned source uses the identical deterministic sequence.
This verifies component paging, not equivalent authenticated backend transport.
Raw footer differences remain evidence. No crop, text or semantic relaxation.

Negative controls exercise actual native candidate registrations: swallow a
controlled Select write, swallow a sort activation, and swallow load-more. Each
produces a failing observable expectation with populated content still present.
The shared assertion also fails a wrong body order and a missing final row. The
native-header snapshot test fails when columnheader capture is removed.

## FileUpload follow-up

The current page publication authenticates its API caller through a bearer;
each capture then creates a fresh anonymous browser context. This does not log
that browser into the owning account. The pinned original FileUpload explicitly
requires `island.viewer()`, a bound declared string Value and a store; otherwise
it says Sign in to upload files. Its boot chooses session-carrying transport for
signed-in direct page origins; an opaque parent sandbox deliberately gets only
anonymous query transport. There is no parent credential relay to emulate.
The candidate unavailable face instead has no adapter and is authored disabled.
These are different availability scenarios, so matching initial styling does not
establish authenticated upload parity.

A separate hosted paired fixture should establish a real verified-email browser
session for the same disposable account used to create a writable stored dataset
(`signInAccount`/`connectionBrowserCookie`); visit each actual hosted page via its
normal app-to-page session handoff; wait for enabled Choose Screenshots. Declare
a live Import + string Value on the old page, and a live `af-dataset` namespace
plus the supported upload adapter on the native page. Use one generated PNG file
and the normal media HTTP doors with observed page edit ID and idempotency key;
never put API tokens into HTML or supply an in-memory upload success response.
Assert selected filename/ref, actual stored-file bytes, removal from the selection,
and permission refusal under a second readable-but-not-insert-authorized session.
Keep this in a separate hosted auth/upload case: the normal raw-reader visual
matrix should remain anonymous. Native dataset HTTP authority differs from the
old binding; discover each real contract rather than granting fake page access.

Gates are SLOW-tier: an implementer runs them ONCE at the end of the brief, NEVER
per edit. Root owns the combined matched original/candidate browser runs. No gate
or user browser was run for this fixture deliverable.
