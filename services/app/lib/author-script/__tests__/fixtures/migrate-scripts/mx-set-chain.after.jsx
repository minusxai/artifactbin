<Helmet>
  <title>Chained set</title>
  <Value name="count" type="number" default={0} />
  <Value name="label" type="string" default="idle" />
  <Mutation name="save">{`insert into log(n) values ($count)`}</Mutation>
  <script>{`
    import { signal, mutation } from 'page';
    import { batch } from 'solid-js';
    const [count, setCount] = signal('$count');
    const [label, setLabel] = signal('$label');
    const save = mutation('$save');

    const button = document.getElementById('go');
    button.addEventListener('click', async () => {
      setCount(1);
      setLabel('a') /* migrated: set is synchronous; its .catch handler was dropped */;
      await setCount(3) /* migrated: set is synchronous; its .catch handler was dropped */;
      setCount(4);
      Promise.resolve(batch(() => { setCount(2); setLabel('b'); })).then(() => { button.textContent = 'saved'; }).catch(() => {});
      save({ count: 5 }).catch((error) => { button.textContent = error.message; });
    });
  `}</script>
</Helmet>
<p><button id="go">Go</button></p>
