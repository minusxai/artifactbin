<Helmet>
  <title>Already Solid</title>
  <Value name="region" type="string" default="west" />
  <Query name="monthly">{`select 1 as total`}</Query>
  <script>{`
    import { signal, query } from 'page';
    import { createEffect } from 'solid-js';

    const [region, setRegion] = signal('$region');
    const monthly = query('$monthly');
    createEffect(() => { document.title = region() + ' ' + monthly().length; });
    export function Detail({ item }) { return <p>{item}</p>; }
    const value = { value: 1 };
    console.log(value.value);
  `}</script>
</Helmet>
<Detail item="x"><p>Loading…</p></Detail>
