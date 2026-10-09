---
name: review-state
description: >-
  What a native comment saves and restores on an interactive page: declared Values, kit view state and named signals.
---
## Read first

A native comment on an interactive wireframe or app saves the state that
determines its view when the reader picks a target, and puts it back when the
thread opens, before locating and highlighting the target. Nothing registers
by hand; three kinds of state are saved:

- **Declared Values** the link carries (every scalar `<Value>` without
  `url={false}`): the step, the region, the selected row. Write them with
  `signal('$step')` from `page` or bind a control to them.
- **Kit view state**: the chosen `Tabs` tab, the open `Accordion` item, a
  `Collapsible` or `Dialog` open or closed, each under its element's own `id`.
  A kit element bound to a Value (`<Tabs value="$tab">`) is saved as that Value.
- **Named signals** in the script: `createSignal(initial, { name: 'screen' })`
  from `solid-js`. An unnamed `createSignal` is scratch state and is never saved.

Static pages and side-by-side wireframe drawings need nothing. Keep afbin's
native comments; do not serialize the DOM or replay the reader's clicks.

## Writing a component

Nobody predicts where comments will land. Keep what the view depends on in
named signals — the screen, the selected id, the step, the open dialog, the
mock scenario — and derive everything else with `createMemo`. Scratch state
(a typing buffer, hover, animation, a fetched response) stays unnamed. Name
the signal where it is created; nothing else is needed.

## Naming

A named signal inside an exported component is saved under the node the
component mounts at (`aBcD:time`), so two `<Player>` tags each keep their
own; at module level it is saved under its bare name. Two signals with one
name in one mount: the last one wins, with a console warning, so give list
items their own names (`{ name: 'open:' + props.item }`). A kit element inside
a component's own JSX gets its own `id` for the same reason.

## Example without Values

Module-level named state and static source targets:

```jsx
<Helmet>
  <script>{`
    import { createSignal, createEffect } from 'solid-js';
    const initial = () => ({screen: 'plans', declined: false});
    const [view, setView] = createSignal(initial(), { name: 'checkout' });
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

A screen the restore mounts reads its own saved values as it mounts, so a
`<Show>` screen may keep named signals of its own.

## Snapshot contract

- A saved value is plain JSON: strings, numbers, booleans, `false`, `null`,
  arrays and plain objects. The comment holds up to 32 KiB and 256 keys; a
  signal holding a DOM node, a function or a Date is skipped with a warning.
- Restoring sets Values and signals as a user's change would; effects run.
  Keep writes in explicit user actions: never submit a form, call a Mutation
  or fetch from an effect of restorable state.
- Save only UI choices and safe mock data every comment reader may see.
  Credentials, private drafts and network responses stay in unnamed signals.
- Restore uses the current artifact, not an archived version. Saved keys the
  page no longer has are ignored; an element written anew gets a new `id`, so
  its saved state goes with the old one. The target and discussion stay.

## Verify through native comments

In a [live session](live-sessions.md), reach a non-default view and create a
native comment on its visible target. Navigate away or reset, then open that
thread: screen, tab, selection and dialog must return together. Reload and
open the persisted thread again. Also save a closed/default view and restore
it from an open dialog. Verify action counters or dataset rows did not change.
