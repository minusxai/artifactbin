<Helmet>
  <title>Counter</title>
  <Value name="count" type="number" default={0} />
  <Value name="label" type="string" default="clicks" />
  <Import name="orders" src="ref:abc123" />
  <Query name="results">{`select count(*) as n from orders where n > $count`}</Query>
  <Mutation name="save">{`insert into log(n) values ($count)`}</Mutation>
  <script>{`
    const button = document.getElementById('increment');
    const out = document.getElementById('out');
    const stop = mx.subscribe(['count', 'results'], (snapshot) => {
      const count = snapshot.signals.count.value;
      const rows = snapshot.signals.results.value?.rows ?? [];
      out.textContent = count + ' / ' + rows.length + (snapshot.signals.results.status === 'pending' ? ' …' : '');
    });
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const snapshot = await mx.read(['count']);
        await mx.set({ count: Number(snapshot.signals.count.value ?? 0) + 1 });
        await mx.set({ count: 0, label: 'reset' });
        await mx.mutate('save', { count: 3 });
        const fresh = await mx.read(['results'], { wait: true });
        out.title = String(fresh.signals.results.value.rows.length);
      } catch (error) { button.textContent = error.message; }
      finally { button.disabled = false; }
    });
    mx.describe().then((d) => console.log(d.signals.length));
    addEventListener('pagehide', stop);
  `}</script>
</Helmet>
<p><button id="increment">Add one</button> <span id="out" /></p>
