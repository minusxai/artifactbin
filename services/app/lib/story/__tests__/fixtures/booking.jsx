<Helmet>
  <title>Book a time</title>
  <Import name="bookings" src="ref:BookRows1" />
  <Value name="day" type="date" />
  <Value name="note" type="string" url={false} />

  <Query name="days">{`
    select value as day, dayname(value) as dow, date_part('day', value) as num, date_format(value, '%b') as mon
    from json_each(date_series(date(to_timezone($_now, $_tz)), date_add(date(to_timezone($_now, $_tz)), 20, 'day')))
    where dayofweek(value) not in (0, 6)
  `}</Query>

  <Query name="picked">{`
    select coalesce($day, (select min(day) from days)) as day,
           date_format(coalesce($day, (select min(day) from days)), '%A, %d %B') as label
  `}</Query>

  <Query name="slots">{`
    with recursive half(n) as (select 0 union all select n + 1 from half where n < 17),
    grid as (
      select picked.day, printf('%02d:%s', 9 + n / 2, case when n % 2 = 0 then '00' else '30' end) as slot
      from picked, half
    )
    select grid.day || '_' || grid.slot as id, grid.day, grid.slot, b.booked_by, b.note,
           b.booked_by is not null and b.booked_by = $_me.id as is_mine,
           b.booked_by is null and grid.day || 'T' || grid.slot > to_timezone($_now, $_tz) as is_open
    from grid left join bookings.rows b on b.day = grid.day and b.slot = grid.slot
    order by grid.slot
  `}</Query>

  <Query name="mine">{`
    select id, day, slot, note from bookings.rows
    where booked_by = $_me.id and day >= date(to_timezone($_now, $_tz))
    order by day, slot
  `}</Query>

  <Mutation name="book" expectedAffected={1} reset="note">{`
    insert into bookings.rows (id, day, slot, booked_by, note, created_at)
    select $id, $day, $slot, $_me.id, coalesce($note, ''), $_now
    where not exists (select 1 from bookings.rows where day = $day and slot = $slot)
  `}</Mutation>

  <Mutation name="cancel" expectedAffected={1}>{`
    delete from bookings.rows where id = $id and booked_by = $_me.id
  `}</Mutation>
</Helmet>
<main data-design="tw" className="@container mx-auto max-w-3xl px-4 py-8">
  <h1 className="text-3xl font-semibold">Book a time</h1>

  <For each={$days} keyBy="day" className="mt-6 flex gap-2 overflow-x-auto">
    <Button set={{"day": "$_row.day"}} variant="outline">{$_row.dow} {$_row.num} {$_row.mon}</Button>
  </For>

  <For each={$picked} keyBy="day">
    <h2 className="mt-8 text-xl font-semibold">{$_row.label}</h2>
  </For>

  <Input label="Note for the booking" value="$note" />

  <For each={$slots} keyBy="id" className="mt-4 grid grid-cols-2 gap-2 @xl:grid-cols-3">
    {($_row.is_open) && (<Button run="$book">{$_row.slot}</Button>)}
    {($_row.is_mine) && (<Button run="$cancel" variant="outline">Cancel {$_row.slot}</Button>)}
  </For>

  <h2 className="mt-10 text-xl font-semibold">Your bookings</h2>
  <DataTable data="$mine" rowKey="id">
    <Column col="day" title="Day" />
    <Column col="slot" title="Time" />
    <Column col="note" title="Note" />
    <Column col="id" title="">
      <Button run="$cancel" variant="outline">Cancel</Button>
    </Column>
  </DataTable>
</main>
