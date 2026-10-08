# Native comment view state

A comment keeps its existing source anchor, quote, range and revision. Optional
`view_state: {v: 1, components: {...}}` records explicitly registered UI/mock state.
Static pages register nothing and keep the existing behavior. Context is bounded
JSON (32 KiB, 64 registrations), persisted on the annotation under its existing ACL.

The author API, imported from `page`, takes ordinary local state:

```js
import { createSignal } from 'solid-js';
import { reviewState } from 'page';
const [screen, setScreen] = createSignal('plans');
reviewState({id: 'navigation', get: screen, restore: value => setScreen(value)});
```

Register at the app lifetime, outside conditionally mounted screens. IDs must be
stable and unique. Register only information safe for everyone who can read the
comment: UI choices and deterministic mock scenarios, never credentials or private
form drafts. All registered state is captured, including default/closed values.
The function returns an unregister callback; a Solid owner also cleans it up, and
stopping the author module clears its registrations.

The document runtime freezes context when a comment target is picked. Native
comments carry it through their existing transport. When a thread opens (or its
Restore saved view button is pressed), the runtime restores context before
locating, highlighting and scrolling to the target. Routine geometry/hover updates
never restore it again. Custom restore functions are synchronous setters; they
must not fetch, submit, send notifications or replay actions. A failed restore
shows a message in the existing thread, retaining the discussion and screenshot.

The author runtime and frame editor are independently bundled. The registry is
attached to the document through a versioned symbol, so both bundles share it.
No callbacks or executable state cross the authenticated frame channel.

Scope: registered local state, not automatic capture of all kit
controls, arbitrary JavaScript memory, backend data, focus, scroll containers,
transient hover state or animation time. Restores run against the current artifact;
archived-version playback and state migrations are future work. A changed set of
registration IDs is refused; custom adapters own compatibility within each ID.
