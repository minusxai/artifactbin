<Helmet>
  <title>Chained set</title>
  <Value name="count" type="number" default={0} />
  <Value name="label" type="string" default="idle" />
  <Mutation name="save">{`insert into log(n) values ($count)`}</Mutation>
  <script>{`
    const button = document.getElementById('go');
    button.addEventListener('click', async () => {
      mx.set({ count: 1 }).catch(() => {});
      mx.set({ label: 'a' }).catch((error) => { console.error(error); });
      await mx.set({ count: 3 }).catch(console.error);
      mx.set({ count: 4 }).then(() => {}).finally(() => undefined);
      mx.set({ count: 2, label: 'b' }).then(() => { button.textContent = 'saved'; }).catch(() => {});
      mx.mutate('save', { count: 5 }).catch((error) => { button.textContent = error.message; });
    });
  `}</script>
</Helmet>
<p><button id="go">Go</button></p>
