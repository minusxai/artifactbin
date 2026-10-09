<Helmet>
  <title>Regional sales</title>
  <Value name="region" type="string" default="west" />
  <Value name="clicks" type="number" default={0} url={false} />
  <Value name="sales" type="table" value={[{"region":"west","month":"Jan","total":120},{"region":"east","month":"Jan","total":90}]} />
  <Query name="monthly">{`select month, total from sales where region = $region order by month`}</Query>
  <Mutation name="bump">{`update sales set total = total + 10 where region = $region`}</Mutation>
  <script>{`
    import { region, clicks, monthly, bump } from 'page';
    import { effect, computed } from '@preact/signals';

    const total = computed(() => monthly.value.reduce((s, r) => s + Number(r.total), 0));
    effect(() => {
      document.querySelector('#summary').textContent =
        region.value + ': ' + total.value + (monthly.loading.value ? ' (updating…)' : '');
      if (monthly.error.value) document.querySelector('#status').textContent = monthly.error.value;
    });
    document.querySelector('#more').addEventListener('click', () => { clicks.value = clicks.value + 1; });
    document.querySelector('#twice').addEventListener('click', () => { clicks.value += 2; clicks.value++; });
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
