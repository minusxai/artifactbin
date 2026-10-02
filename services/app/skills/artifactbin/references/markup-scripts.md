---
name: markup-scripts
description: >-
  The Helmet script: an ES module in the document, the declared names as Preact signals, any npm library, exported components mounted from markup.
---
## Read first

The one `<script>` in `<Helmet>` runs **in the document itself** as an ES
module, after the markup is in the DOM: native DOM access, `import`, top-level
`await`, strict mode. The names the Helmet declares import from `page` as
Preact signals. Markup carries content, data and layout; the script carries
behaviour: DOM handlers, canvas, a library, a component of your own.

- **Ownership**: a node bound in markup (`value="$region"`, `{$clicks}`,
  `data="$monthly"`) changes through its signal; every other node the script
  may touch freely.
- **The trap**: reading `.value` outside an `effect` (or a `computed`, or a
  component's render) is a one-time copy and subscribes to nothing.
- A script that does not build is refused at publish as `invalid_script` with
  the message: a syntax error, an undeclared name imported from `page`, a
  relative import.

## Contents

Example · Imports · The page module · Components · Libraries.

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
    import { region, clicks, monthly, bump } from 'page';
    import { effect, computed } from '@preact/signals';
    import { useState } from 'preact/hooks';

    const total = computed(() => monthly.value.reduce((s, r) => s + Number(r.total), 0));
    effect(() => {
      document.querySelector('#summary').textContent =
        region.value + ': ' + total.value + (monthly.loading.value ? ' (updating…)' : '');
    });
    document.querySelector('#more').addEventListener('click', () => { clicks.value = clicks.value + 1; });
    document.querySelector('#bump').addEventListener('click', async () => {
      const status = document.querySelector('#status');
      try { await bump(); status.textContent = 'saved'; }
      catch (error) { status.textContent = error.message; }
    });

    export function Bars({ rows, color }) {
      const [hover, setHover] = useState(null);
      const max = Math.max(1, ...rows.value.map((r) => Number(r.total)));
      return (
        <svg viewBox="0 0 200 60" style={{ width: '100%', height: 80 }}>
          {rows.value.map((r, i) => (
            <rect key={r.month} x={i * 48 + 8} width={36} y={60 - (r.total / max) * 56} height={(r.total / max) * 56}
              fill={hover === i ? 'currentColor' : color} onMouseEnter={() => setHover(i)} />
          ))}
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
| `page` | the declared names (below) |
| `@preact/signals` | `signal`, `computed`, `effect`, `batch` |
| `preact`, `preact/hooks` | Preact, the page's own instance |
| `react`, `react-dom` | `preact/compat` |
| any other bare name | that npm package from `https://esm.sh/<name>`, subpaths too |
| `https://…` | that module |

Relative imports do not exist: nothing sits beside the script.

## The page module

- **A Value** is a writable signal: `region.value` reads it, `region.value =
  'east'` writes it; bound markup re-renders and dependent queries re-run. A
  `type="table"` Value is read-only rows, like a Query.
- **A Query** is a read-only signal of its rows, already loaded at page load.
  `monthly.loading.value` is true while a re-run is in flight (the old rows
  stay in `.value` meanwhile); `monthly.error.value` is the engine's message
  or null; `await monthly.ready` gives the next settled rows and rejects with
  the engine's message.
- **A Mutation** is an async function: `await rename({ from: 'west', to:
  'West' })` resolves after commit and rejects with the server's message, so
  wrap it in `try`/`catch`. A row-scoped one takes `_row: { id: 7 }`.
  Permissions still apply.

## Components

JSX in the script is Preact JSX. A component the script exports mounts
wherever markup writes its name as a tag (any capitalized tag that is not a
kit component): `<Bars rows={$monthly} color="teal"><p>Loading…</p></Bars>`.
Literal props arrive as values; a `$name` prop arrives as the signal, so read
`rows.value`. The children are the server-rendered fallback until it mounts.
Inside a component, `onClick` and friends are ordinary Preact; markup itself
still has no handlers. Import `@preact/signals` in a script that exports
components: that import is what re-renders a component when a signal it read
changes.

## Libraries

Import a library by its npm name or by URL. Pin a version (`three@0.170.0`)
when the page must not change under its readers. `fetch` reaches HTTPS URLs
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
