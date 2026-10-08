---
name: markup-scripts
description: >-
  The Helmet script: an ES module in the document, Solid bound to the declared names, any npm library, exported components mounted from markup.
---
## Read first

The one `<script>` in `<Helmet>` runs **in the document itself** as an ES
module, after the markup is in the DOM, with `import`, top-level `await` and
strict mode. It is Solid, on the page's own Solid: bind a declared
name with `import { signal, query, mutation } from 'page'`, by the name the
markup spells: `signal('$region')`. Markup carries content, data and layout;
the script carries behaviour.

- **Ownership**: a node bound in markup (`value="$region"`, `{$clicks}`,
  `data="$monthly"`) changes through its signal; every other node the script
  may touch freely.
- **The trap**: reading `region()` outside an effect, a memo or JSX is a
  one-time copy and subscribes to nothing. So is destructuring `props`.
- A script that does not build is refused at publish as `invalid_script` with
  the line: a syntax error, an undeclared or wrong-kind `$name`,
  `createSignal('$region')` (a local signal bound to nothing), a relative import.

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
    import { signal, query, mutation } from 'page';            // the three binders
    import { createEffect, createMemo, createSignal, For } from 'solid-js';

    const [region] = signal('$region');                         // a Value: Solid's [read, write]; only the accessor is needed here
    const [clicks, setClicks] = signal('$clicks');              // clicks() reads, setClicks(n) writes; markup and queries follow
    const monthly = query('$monthly');                          // a Query: monthly() rows; .loading(), .error(), await .ready
    const bump = mutation('$bump');                             // a Mutation: an async function that resolves after commit

    const total = createMemo(() => monthly().reduce((s, r) => s + Number(r.total), 0));   // derived, cached until monthly changes
    createEffect(() => {                                        // runs now and whenever a signal it CALLS changes
      document.querySelector('#summary').textContent =          // unbound markup: the script owns it
        region() + ': ' + total() + (monthly.loading() ? ' (updating…)' : '');
    });
    document.querySelector('#more').addEventListener('click', () => setClicks(clicks() + 1));   // write a Value
    document.querySelector('#bump').addEventListener('click', async () => {
      const status = document.querySelector('#status');
      try { await bump(); status.textContent = 'saved'; }      // readers of the table re-run
      catch (error) { status.textContent = error.message; }     // the server's refusal, verbatim
    });

    export function Bars(props) {                               // mounted from markup below; keep props whole
      const [hover, setHover] = createSignal(null);             // local state: the same primitive
      const max = () => Math.max(1, ...props.rows.map((r) => Number(r.total)));   // props.rows: the tracked rows, not a function
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
  <Select label="Region" value="$region" options={["west", "east"]} />   {/* bound: changes via its signal */}
  <p id="summary">Loading…</p>
  <p>Clicks: {$clicks} <button id="more">More</button> <button id="bump">Add 10</button> <span id="status" /></p>
  <Bars rows={$monthly} color="var(--chart-1)"><p>Loading chart…</p></Bars>   {/* the script's component; children = fallback */}
</div>
```

In Helmet script text, split `</script` as `'</scr' + 'ipt'`.

## Imports

| Specifier | Gives |
| --- | --- |
| `page` | `signal`, `query`, `mutation` (below); [dataset attachments](markup-upload.md); [`reviewState`](review-state.md); `proxy` (Other hosts) |
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

- **A Value**: `const [region, setRegion] = signal('$region')`, Solid's pair:
  `region()` reads, `setRegion('east')` writes; bound markup and dependent queries follow.
- **A Query** (or a `type="table"` Value): `const monthly = query('$monthly')`
  is an accessor of its rows, loaded at page load. `monthly.loading()` is true
  during a re-run (old rows stay); `monthly.error()` is the engine's message or
  null; `await monthly.ready` gives the next settled rows or rejects with it.
- **A Mutation**: `const rename = mutation('$rename')` is an async function.
  `await rename({ from: 'west', to: 'West' })` resolves after commit, rejects
  with the server's message (`try`/`catch`).

## Components

Solid components run once; reads inside JSX, memos and effects stay reactive.
Exported components mount at their capitalized tag; children are the fallback.

```jsx
export function Detail(props) { const item = () => props.item[0]; return <p>{item()?.total}</p>; }
```

props.item is the current rows array (tracked; read it inside JSX, a memo or
an effect), not a function; a literal prop such as color is a plain value.

## Libraries

Import a library by its npm name or by URL. Pin a version in every specifier (`three@0.170.0`, `three@0.170.0/examples/…`).

```jsx
<canvas id="scene" className="block h-[420px] w-full" />
<Helmet><script>{`
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  const canvas = document.querySelector('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas });
  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.z = 4;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3), new THREE.MeshNormalMaterial()));
  const controls = new OrbitControls(camera, canvas);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
`}</script></Helmet>
```

## Other hosts

A host outside the default policy is declared in the Helmet (https origins,
no paths, `*.` wildcard only, at most 10 per meta):

```jsx
<Helmet>
  <meta name="csp-connect" content="https://api.open-meteo.com" />
  <meta name="csp-script" content="https://cdn.plot.ly" />
</Helmet>
```

Also `csp-style` (fonts too), `csp-img`, `csp-media`, `csp-frame`; other
names are `invalid_csp`. Publishing a host is your consent; every other
reader is asked (once, for this document, or never) and until then its
requests fail: handle a failed `fetch`.

Fetching other hosts: read a `csp-connect` host through the document, GET
only: `fetch(proxy('https://api.example.com/x'))`, `proxy` from `page`;
403 until the reader allows it.
