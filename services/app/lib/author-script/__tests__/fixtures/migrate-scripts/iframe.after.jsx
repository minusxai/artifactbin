<Helmet>
  <title>Canvas counter</title>
  <Value name="count" type="number" default={0} />
  <style>{`.lede { font-weight: 600; }
/* migrated from Iframe "Counter canvas" */
#Ab3d {margin:16px;font:16px system-ui} #Ab3d canvas, #Ab3d button {display:block;margin-top:12px} @media (max-width: 600px) { #Ab3d { margin: 4px } }
#Ab3d { min-height: 220px; }
`}</style>
  <script>{`
    import { signal } from 'page';
    import { createEffect, createRoot } from 'solid-js';
    const [count, setCount] = signal('$count');
    /* migrated from mx: the old snapshot shape, { signals: { name: { value, status, error? } } }, over the bindings */
    const mxBindings = { "count": ["value", count] };
    const mxSnapshot = (names) => ({ signals: Object.fromEntries(names.map((name) => {
      const [kind, read] = mxBindings[name];
      if (kind === 'value') return [name, { value: read(), status: 'ready' }];
      const rows = read(), error = read.error();
      return [name, { value: { rows, columns: Object.keys(rows[0] ?? {}) }, status: read.loading() ? 'pending' : error ? 'error' : 'ready', ...(error ? { error: { code: 'QUERY_ERROR', message: error } } : {}) }];
    })) });
    const mxRead = async (names, options = {}) => {
      if (options.wait || options.refresh) await Promise.all(names.filter((name) => mxBindings[name][0] === 'query').map((name) => mxBindings[name][1].ready));
      return mxSnapshot(names);
    };
    const mxSubscribe = (names, fn) => createRoot((dispose) => { createEffect(() => fn(mxSnapshot(names))); return dispose; });

    /* migrated from Iframe "Counter canvas" (#Ab3d) */
    {
      const canvas = document.getElementById('counter');
      const ctx = canvas.getContext('2d');
      function draw(snapshot) {
        const count = snapshot.signals.count.value;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillText('Count: ' + (count ?? 0), 12, 55);
      }
      const stop = mxSubscribe(['count'], draw);
      document.getElementById('increment').addEventListener('click', async () => {
        const snapshot = await mxRead(['count']);
        await setCount(Number(snapshot.signals.count.value ?? 0) + 1);
      });
      addEventListener('pagehide', stop);
    }
`}</script>
</Helmet>
<p className="lede">The canvas below reads the shared count.</p>
{/* migrated from Iframe */}
<div id="Ab3d" role="group" aria-label="Counter canvas">
  <button id="increment" aria-label="Increment count">Add one</button>
  <canvas id="counter" width={280} height={100} />
</div>
