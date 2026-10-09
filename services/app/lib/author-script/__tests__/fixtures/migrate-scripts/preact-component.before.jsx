<Helmet>
  <title>Bars</title>
  <Query name="monthly">{`select 'Jan' as month, 120 as total`}</Query>
  <script>{`
    import { monthly } from 'page';
    import { useState } from 'preact/hooks';

    export function Bars({ rows, color }) {
      const [hover, setHover] = useState(null);
      return <svg>{rows.value.map((r, i) => <rect key={r.month} fill={hover === i ? 'black' : color} onMouseEnter={() => setHover(i)} />)}</svg>;
    }
    console.log(monthly.value.length);
  `}</script>
</Helmet>
<Bars rows={$monthly} color="teal"><p>Loading chart…</p></Bars>
