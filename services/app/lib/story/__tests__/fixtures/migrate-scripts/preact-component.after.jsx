<Helmet>
  <title>Bars</title>
  <Query name="monthly">{`select 'Jan' as month, 120 as total`}</Query>
  <script>{`
    import { query } from 'page';
    const monthly = query('$monthly');

    /* MIGRATE: 'preact/hooks' is Preact/React: port this component code to Solid by hand (props are getters, hooks become createSignal/createEffect) */ import { useState } from 'preact/hooks';

    /* MIGRATE: a component destructures its props; read \`props.x\` (a getter, already the value) instead */ export function Bars({ rows, color }) {
      const [hover, setHover] = useState(null);
      return <svg>{rows.value.map((r, i) => <rect key={r.month} fill={hover === i ? 'black' : color} onMouseEnter={() => setHover(i)} />)}</svg>;
    }
    console.log(monthly().length);
  `}</script>
</Helmet>
<Bars rows={$monthly} color="teal"><p>Loading chart…</p></Bars>
