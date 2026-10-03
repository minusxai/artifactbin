<Helmet>
  <title>Regional sales</title>
  <Value name="region" type="string" default="west" />
  <Value name="clicks" type="number" default={0} url={false} />
  <Value name="sales" type="table" value={[{"region":"west","month":"Jan","total":120},{"region":"east","month":"Jan","total":90}]} />
  <Query name="monthly">{`select month, total from sales where region = $region order by month`}</Query>
  <Mutation name="bump">{`update sales set total = total + 10 where region = $region`}</Mutation>
  <script>{`
    import { signal, query, mutation } from 'page';
    import { createEffect, createMemo } from 'solid-js';
    const [region, setRegion] = signal('$region');
    const [clicks, setClicks] = signal('$clicks');
    const monthly = query('$monthly');
    const bump = mutation('$bump');

    const total = createMemo(() => monthly().reduce((s, r) => s + Number(r.total), 0));
    createEffect(() => {
      document.querySelector('#summary').textContent =
        region() + ': ' + total() + (monthly.loading() ? ' (updating…)' : '');
      if (monthly.error()) document.querySelector('#status').textContent = monthly.error();
    });
    document.querySelector('#more').addEventListener('click', () => { setClicks(clicks() + 1); });
    document.querySelector('#twice').addEventListener('click', () => { setClicks(clicks() + (2)); setClicks(clicks() + 1); });
    document.querySelector('#bump').addEventListener('click', async () => {
      const status = document.querySelector('#status');
      try { await bump(); status.textContent = 'saved'; }
      catch (error) { status.textContent = error.message; }
    });
    monthly.ready.then((rows) => console.log(rows.length));
  `}</script>
</Helmet>
<div className="space-y-4 p-6">
  <Select label="Region" value="$region" options={["west", "east"]} />
  <p id="summary">Loading…</p>
  <p>Clicks: {$clicks} <button id="more">More</button> <button id="twice">Twice</button> <button id="bump">Add 10</button> <span id="status" /></p>
</div>
