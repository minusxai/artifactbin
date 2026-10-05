---
name: review-state
description: >-
  Makes native comments restore an interactive app or wireframe's registered UI state.
---
## Read first

For an interactive wireframe or app reviewed through comments, register the
state that determines its view with `reviewState({id, get, restore})` from
`page`. Native comments capture it when the reader picks a target; opening
the thread restores it before locating the target. Keep afbin's native
comments; the app only supplies state. No registration is needed for static
pages or side-by-side wireframe drawings.

Use ordinary Solid local state or bind existing Values with `signal` from
`page`. `Value` is optional; neither Values nor kit controls are captured
automatically. Conditional rendering and show/hide both work when driven by
registered state. Do not try to serialize the DOM or replay the reader's clicks.

## Authoring pattern

Start with one small object for the whole view: screen, selected item ID,
tab, filter, dialog open/closed, and a deterministic mock scenario such as
`payment-declined`. Render from it. Keep derived display text out of the
snapshot. Register once at app lifetime, outside conditional screens; keep
the registration ID stable across edits. Multiple independent registrations
are supported when needed. Each body element also retains its persistent
source `id`, so native comments can locate it after restoring the view.

This minimal example uses static source targets and ordinary local state:

```jsx
<Helmet>
  <script>{`
    import { createSignal, createEffect } from 'solid-js';
    import { reviewState } from 'page';
    const initial = () => ({screen: 'plans', declined: false});
    const [view, setView] = createSignal(initial());
    reviewState({id: 'checkout', get: view, restore: saved => setView(saved)});
    const el = id => document.getElementById(id);
    el('continue').addEventListener('click', () => setView({screen: 'checkout', declined: false}));
    el('try-payment').addEventListener('click', () => setView({screen: 'checkout', declined: true}));
    el('reset').addEventListener('click', () => setView(initial()));
    createEffect(() => {
      el('plans').hidden = view().screen !== 'plans';
      el('checkout').hidden = view().screen !== 'checkout';
      el('payment-error').hidden = !view().declined;
    });
  `}</script>
</Helmet>
<div id="review-demo" data-design="tw" className="space-y-4 p-6">
  <p id="demo-note">Mock checkout. No real payments. Refresh resets the flow.</p>
  <button id="reset">Reset flow</button>
  <section id="plans">
    <h1 id="plans-title">Choose your plan</h1>
    <button id="continue">Continue with Pro</button>
  </section>
  <section id="checkout" hidden={true}>
    <h2 id="checkout-title">Review your upgrade</h2>
    <button id="try-payment">Try demo payment</button>
    <p id="payment-error" hidden={true}>Your payment was declined.</p>
  </section>
</div>
```

Already using a declared scalar Value? Register its accessor and setter:
`const [step, setStep] = signal('$step');`
`reviewState({id: 'step', get: step, restore: saved => setStep(saved)});`
For several signals, restore them together with Solid's `batch`.

## Snapshot contract

- `get()` returns small JSON data. Include defaults, `false`, `null` and
  empty selections; omitting closed/default state leaves the previous view behind.
- `restore(saved)` synchronously sets state. It must not submit a form,
  call a Mutation, retry a payment, or fetch. Effects triggered by restored
  signals must not perform writes either; keep writes in explicit user actions.
- Save only UI choices and safe mock data that every comment reader may see.
  Exclude credentials, private drafts, DOM nodes, functions and network responses.
  The combined snapshot is limited to 32 KiB and 64 registrations.
- Registration returns a cleanup callback; a Solid owner and author-module
  disposal also clean up. Register above conditional screens so navigation
  does not change the set of registered IDs.
- Restore uses the current artifact, not an archived version or backend
  snapshot. Changed registration IDs refuse restoration; your adapter must
  handle or reject older shapes within an ID. Keep the comment target and discussion.

## Verify through native comments

In a [live session](live-sessions.md), reach a non-default view and create a
native comment on its visible target. Navigate away or reset, then open that
thread: screen, selection and dialog must return together. Reload and open
the persisted thread again. Also save a closed/default view and restore it
from an open dialog. Verify action counters or dataset rows did not change.
Static pages continue to use their existing target and selected-text anchors.
