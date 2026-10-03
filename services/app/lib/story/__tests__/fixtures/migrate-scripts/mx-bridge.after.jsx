<Helmet>
  <title>Counter</title>
  <Value name="count" type="number" default={0} />
  <Value name="label" type="string" default="clicks" />
  <Import name="orders" src="ref:abc123" />
  <Query name="results">{`select count(*) as n from orders where n > $count`}</Query>
  <Mutation name="save">{`insert into log(n) values ($count)`}</Mutation>
  <script>{`
    import { signal, query, mutation } from 'page';
    import { batch, createEffect, createRoot } from 'solid-js';
    const [count, setCount] = signal('$count');
    const results = query('$results');
    const [label, setLabel] = signal('$label');
    const save = mutation('$save');
    /* migrated from mx: the old snapshot shape, { signals: { name: { value, status, error? } } }, over the bindings */
    const mxBindings = { "count": ["value", count], "results": ["query", results] };
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

    const button = document.getElementById('increment');
    const out = document.getElementById('out');
    const stop = mxSubscribe(['count', 'results'], (snapshot) => {
      const count = snapshot.signals.count.value;
      const rows = snapshot.signals.results.value?.rows ?? [];
      out.textContent = count + ' / ' + rows.length + (snapshot.signals.results.status === 'pending' ? ' …' : '');
    });
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const snapshot = await mxRead(['count']);
        await setCount(Number(snapshot.signals.count.value ?? 0) + 1);
        await batch(() => { setCount(0); setLabel('reset'); });
        await save({ count: 3 });
        const fresh = await mxRead(['results'], { wait: true });
        out.title = String(fresh.signals.results.value.rows.length);
      } catch (error) { button.textContent = error.message; }
      finally { button.disabled = false; }
    });
    /* MIGRATE: \`mx.describe()\` has no equivalent: the bindings are named where they are bound */ mx.describe().then((d) => console.log(d.signals.length));
    addEventListener('pagehide', stop);
  `}</script>
</Helmet>
<p><button id="increment">Add one</button> <span id="out" /></p>
