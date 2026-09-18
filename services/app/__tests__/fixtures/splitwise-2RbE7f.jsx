<Helmet>
  <title>Splitwise tracker</title>
  <Value name="item" type="string" url={false} />
  <Value name="amount" type="number" url={false} />
  <Value name="spent_on" type="date" url={false} />
  <Query name="balances" source="ref:hf8fYY">{`
    select p.person,
           coalesce(sum(e.amount), 0)
             - (select coalesce(sum(amount), 0) from public.expenses)
               / nullif((select count(*) from public.people), 0) as net
    from public.people p left join public.expenses e on e.paid_by = p.person
    group by p.person order by net desc
  `}</Query>
  <Query name="tab" source="ref:hf8fYY">{`
    select id, spent_on, item, amount, paid_by from public.expenses
    order by spent_on desc
  `}</Query>
  <Query name="total" source="ref:hf8fYY">{`select coalesce(sum(amount), 0) as amount from public.expenses`}</Query>
  <Mutation name="join" source="ref:hf8fYY">{`
    insert into public.people (person, joined_on)
    select $_me, current_date
    where not exists (select 1 from public.people where person = $_me)
  `}</Mutation>
  <Mutation name="add" source="ref:hf8fYY" reset="item amount spent_on">{`
    insert into public.expenses (id, paid_by, spent_on, item, amount)
    select uuid(), $_me, coalesce($spent_on, current_date), $item, $amount
  `}</Mutation>
</Helmet>
<div data-design="tw" className="@container p-8" id="K3dZ">
  <main className="mx-auto max-w-2xl space-y-6" id="Sw0v">
    <header id="LIvJ">
      <h1 className="text-2xl font-bold" id="CPKu">Splitwise tracker</h1>
      <p className="text-muted-foreground" id="fyXg">Log shared expenses with friends and see who owes what. Costs split evenly across everyone who has joined.</p>
    </header>

    {$_me ? (<><p id="y6k4">You are <User userId="$_me" avatar />. <Button run="$join" id="D6IP">Join this tab</Button></p></>) : (<><SignIn id="Yzbp">Sign in to join this tab</SignIn></>)}

    <h2 className="text-lg font-semibold" id="MXTF">Balances</h2>
    <DataTable data="$balances" rowKey="person" id="F5ep">
      <Column col="person" title="Person" id="BvDc"><User userId="$_row.person" /></Column>
      <Column col="net" title="Net" fmt="$,.2f" align="right" id="GsFJ" />
    </DataTable>

    {$_me ? (<><Card id="EgYW"><CardHeader id="XOVl"><CardTitle id="tdN1">Add an expense</CardTitle></CardHeader>
          <CardContent className="space-y-3" id="tqXh">
            <input aria-label="What it was for" type="text" placeholder="What was it for?" value="$item" id="PHtu" />
            <input aria-label="Amount" type="number" min={0} placeholder="Amount" value="$amount" id="h06i" />
            <DatePicker label="Spent on" value="$spent_on" id="e3Al" />
            <Button run="$add" id="CL5g">Add expense</Button>
          </CardContent></Card></>) : (<><SignIn className="w-full" id="G0eF">Sign in to add an expense</SignIn></>)}

    <h2 className="text-lg font-semibold" id="AT6Q">All expenses</h2>
    <p className="text-sm text-muted-foreground" id="p7fy">Total spent: <Number data="$total" col="amount" prefix="$" format=",.2f" id="SmIg" /></p>
    <DataTable data="$tab" rowKey="id" id="kpL9">
      <Column col="spent_on" title="Date" id="UGzc" />
      <Column col="item" title="Item" id="Hace" />
      <Column col="amount" title="Amount" fmt="$,.2f" align="right" id="HjQg" />
      <Column col="paid_by" title="Paid by" id="FP0D"><User userId="$_row.paid_by" /></Column>
    </DataTable>
  </main>
</div>
