---
name: markup-scripts
description: >-
  The Helmet script: an ES module in the document, Solid bound to the declared names, any npm library, exported components mounted from markup.
---
## Read first

The one `<script>` in `<Helmet>` runs **in the document itself** as an ES
module, after the markup is in the DOM: native DOM access, `import`, top-level
`await`, strict mode. It is Solid, on the page's own Solid: bind a declared
name with `import { signal, query, mutation } from 'page'`, by the name the
markup spells: `signal('$region')`. Markup carries content, data and layout;
the script carries behaviour: DOM handlers, canvas, a library, a component.

- **Ownership**: a node bound in markup (`value="$region"`, `{$clicks}`,
  `data="$monthly"`) changes through its signal; every other node the script
  may touch freely.
- **The trap**: reading `region()` outside an effect, a memo or JSX is a
  one-time copy and subscribes to nothing. So is destructuring `props`.
- A script that does not build is refused at publish as `invalid_script` with
  the message and line: a syntax error, an undeclared or wrong-kind `$name`, a
  `createSignal('$region')` (a local signal bound to nothing), a relative import.

## Contents

Example · Imports · The page module · Components · Libraries · Other hosts.

## Example

```jsx
<Helmet>
  <title>Regional sales</title>
  <Value name="region" type="string" default="west" />
  <Value name="clicks" type="number" default={0} url={false} />
  <Value name="sales" type="table" value={[{"region":"west","month":"Jan","total":120},{"region":"west","month":"Feb","total":140},{"region":"east","month":"Jan","total":90},{"region":"east","month":"Feb","total":160}]} />
  <Query name="monthly">{`select month, total from sales where region = $region order by month`}</Query>
  <Mutation name="bump">{`update sales set total = total + 10 where region = $region`}</Mutation>
  <script>{`
    import { signal, query, mutation } from 'page';
    import { createEffect, createMemo, createSignal, For } from 'solid-js';

    const [region] = signal('$region');
    const [clicks, setClicks] = signal('$clicks');
    const monthly = query('$monthly');
    const bump = mutation('$bump');

    const total = createMemo(() => monthly().reduce((s, r) => s + Number(r.total), 0));
    createEffect(() => {
      document.querySelector('#summary').textContent =
        region() + ': ' + total() + (monthly.loading() ? ' (updating…)' : '');
    });
    document.querySelector('#more').addEventListener('click', () => setClicks(clicks() + 1));
    document.querySelector('#bump').addEventListener('click', async () => {
      const status = document.querySelector('#status');
      try { await bump(); status.textContent = 'saved'; }
      catch (error) { status.textContent = error.message; }
    });

    export function Bars(props) {
      const [hover, setHover] = createSignal(null);
      const max = () => Math.max(1, ...props.rows.map((r) => Number(r.total)));
      const h = (r) => (Number(r.total) / max()) * 56;
      return (
        <svg viewBox="0 0 200 60" style={{ width: '100%', height: '80px' }}>
          <For each={props.rows}>{(r, i) => (
            <rect x={i() * 48 + 8} width={36} y={60 - h(r)} height={h(r)}
              fill={hover() === i() ? 'currentColor' : props.color} onMouseEnter={() => setHover(i())} />
          )}</For>
        </svg>
      );
    }
  `}</script>
</Helmet>
<div data-design="tw" className="@container space-y-4 p-6">
  <Select label="Region" value="$region" options={["west", "east"]} />
  <p id="summary">Loading…</p>
  <p>Clicks: {$clicks} <button id="more">More</button> <button id="bump">Add 10</button> <span id="status" /></p>
  <Bars rows={$monthly} color="var(--chart-1)"><p>Loading chart…</p></Bars>
</div>
```

In Helmet script text, split `</script` as `'</scr' + 'ipt'`.

## Imports

| Specifier | Gives |
| --- | --- |
| `page` | `signal`, `query`, `mutation` (below) |
| `solid-js` | `createSignal`, `createEffect`, `createMemo`, `createRoot`, `batch`, `untrack`, `on`, `onMount`, `onCleanup`, `For`, `Show`, `Switch`, `Match`, `mergeProps`, `splitProps` |
| `solid-js/web` | `render`, and what JSX compiles to |
| `solid-js/store` | `createStore`, `reconcile` |
| any other bare name | that npm package from `https://esm.sh/<name>`, subpaths too |
| `https://…` | that module |

The three `solid-js` specifiers are the page's own Solid, the kit's instance:
one reactive graph. Relative imports do not exist: nothing sits beside the
script.

## The page module

Each binder takes one string literal, the declared name with its `$`.

- **A Value**: `const [region, setRegion] = signal('$region')` is Solid's
  pair. `region()` reads it; `setRegion('east')` writes it, and bound markup
  re-renders and dependent queries re-run.
- **A Query** (or a `type="table"` Value): `const monthly = query('$monthly')`
  is an accessor of its rows, already loaded at page load. `monthly.loading()`
  is true while a re-run is in flight (the old rows stay in `monthly()`
  meanwhile); `monthly.error()` is the engine's message or null; `await
  monthly.ready` gives the next settled rows and rejects with the engine's message.
- **A Mutation**: `const rename = mutation('$rename')` is an async function.
  `await rename({ from: 'west', to: 'West' })` resolves after commit and
  rejects with the server's message, so wrap it in `try`/`catch`. A
  row-scoped one takes `_row: { id: 7 }`. Permissions still apply.

## Components

JSX in the script is Solid JSX: the component function runs once, and what
it reads inside JSX, a memo or an effect updates in place. A component the
script exports mounts wherever markup writes its name as a tag (any
capitalized tag that is not a kit component), rendered with Solid's `render`;
the children are the server-rendered fallback until it mounts.

```jsx
export function Detail(props) {
  const item = () => props.item[0];
  return <p style={{ color: props.color }}>{item()?.month}: {item()?.total}</p>;
}
// markup: <Detail item={$monthly} color="teal"><p>Loading…</p></Detail>
```

props.item is the current rows array (tracked; read it inside JSX, a memo or
an effect), not a function; a literal prop such as color is a plain value.
Inside a component, `onClick` and friends are ordinary Solid; markup itself
still has no handlers.

## Libraries

Import a library by its npm name or by URL. To pin a version, pin it in every
specifier of that package (`three@0.170.0`, `three@0.170.0/examples/…`). `fetch` reaches HTTPS URLs
that allow cross-origin reads.

```jsx
<canvas id="scene" className="block h-[420px] w-full" />
<Helmet><script>{`
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  const canvas = document.querySelector('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.z = 4;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 128, 16), new THREE.MeshNormalMaterial()));
  const controls = new OrbitControls(camera, canvas);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
`}</script></Helmet>
```

## Other hosts

When a script needs a host outside the default policy, declare it in the
Helmet, https origins only (no paths; a wildcard only as a leading `*.`;
at most 10 per meta):

```jsx
<Helmet>
  <meta name="csp-connect" content="https://api.open-meteo.com" />
  <meta name="csp-script" content="https://cdn.plot.ly" />
</Helmet>
```

Also `csp-style` (fonts too), `csp-img`, `csp-media`, `csp-frame`; any
other `csp-` name is `invalid_csp`. Publishing a host is your consent;
every other reader, the owner included, is asked (once, always for this
document, or never), and until then requests to it fail, so handle a
failed `fetch`.
