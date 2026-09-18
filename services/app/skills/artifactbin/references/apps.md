---
name: apps
description: >-
  An app several people use: account-backed rows, joining by link, a guest door and writes that are tested before handover.
order: 1
---
## Read first

"Shared with my friends", "one row per person", "who paid", "RSVP", "vote" — the
request is an APP, not a document. Its shape is fixed: an EMPTY stored dataset
with `user` columns, a page that writes to it, and every person carried as their
ACCOUNT. Never a typed name, never a seeded person, never a "Me" row.

[User fields](databases-users.md) is the grammar; this is one whole app, once.

## Contents

The dataset · The page · Three mistakes · Before you hand it over.

## The dataset: declared columns, no rows

A sheet the people using the page fill in later publishes EMPTY. Save the
definition as `tab.jsx` — it is not your page:

```jsx
<Dataset kind="stored">
  <Table schema="public" name="people" rows={[]}
    columns={[{"name":"person","type":"user","constraints":{"self":true}},
              {"name":"joined_on","type":"date"}]} />
  <Table schema="public" name="expenses" rows={[]}
    columns={[{"name":"id","type":"string"},
              {"name":"paid_by","type":"user","constraints":{"self":true}},
              {"name":"spent_on","type":"date"},
              {"name":"item","type":"string"},
              {"name":"amount","type":"number"}]} />
</Dataset>
```

`self: true` on the column that records WHO did it: the server refuses any other
account there, so a row cannot be filed under someone else. Save `tab.yaml`
beside it:

```yaml
type: dataset
title: Trip tab
source: tab.jsx
access: readwrite
```

```sh
afbin push tab.yaml --policy viewers-write --yes --json
```

`--policy viewers-write` is the difference between "my friends can read it" and
"my friends can use it": without it only people you shared it with as editors
write. Use the returned dataset id in place of `tab123` below.

## The page

```jsx
<Helmet>
  <Value name="item" type="string" url={false} />
  <Value name="amount" type="number" url={false} />
  <Value name="spent_on" type="date" url={false} />
  <Query name="balances" source="ref:tab123">{`
    select p.person,
           coalesce(sum(e.amount), 0)
             - (select coalesce(sum(amount), 0) from public.expenses)
               / (select count(*) from public.people) as net
    from public.people p left join public.expenses e on e.paid_by = p.person
    group by p.person order by net desc
  `}</Query>
  <Query name="tab" source="ref:tab123">{`
    select id, spent_on, item, amount, paid_by from public.expenses
    order by spent_on desc
  `}</Query>
  <Mutation name="join" source="ref:tab123">{`
    insert into public.people (person, joined_on)
    select $_me, current_date
    where not exists (select 1 from public.people where person = $_me)
  `}</Mutation>
  <Mutation name="add" source="ref:tab123" reset="item amount spent_on">{`
    insert into public.expenses (id, paid_by, spent_on, item, amount)
    select uuid(), $_me, coalesce($spent_on, current_date), $item, $amount
  `}</Mutation>
</Helmet>
<main className="mx-auto max-w-2xl space-y-6 p-8">
  <h1>Trip tab</h1>
  {$_me ? <p>You are <User id="$_me" avatar />. <Button run="$join">Join this tab</Button></p>
        : <SignIn>Sign in to join this tab</SignIn>}
  <DataTable data="$balances" rowKey="person">
    <Column col="person" title="Person"><User id="$_row.person" /></Column>
    <Column col="net" title="Net" fmt="$,.2f" align="right" />
  </DataTable>
  {$_me ? <Card><CardContent className="space-y-3">
      <input aria-label="What it was for" type="text" value="$item" />
      <input aria-label="Amount" type="number" min={0} value="$amount" />
      <DatePicker label="Spent on" value="$spent_on" />
      <Button run="$add">Add expense</Button>
    </CardContent></Card>
        : <SignIn className="w-full">Sign in to add an expense</SignIn>}
  <DataTable data="$tab" rowKey="id">
    <Column col="spent_on" title="Date" />
    <Column col="item" title="Item" />
    <Column col="amount" title="Amount" fmt="$,.2f" align="right" />
    <Column col="paid_by" title="Paid by"><User id="$_row.paid_by" /></Column>
  </DataTable>
</main>
```

Line by line, this is the whole pattern:

- **Joining is one button.** `where not exists` makes it idempotent, so the
  second press adds nothing and nobody has to be invited by hand. A mutation
  binding `$_me` needs a signed-in reader, so the person who clicks it IS the
  person who joins.
- **Every row records its author** with `$_me`, and is READ back with
  `<User id="$_row.paid_by" />` — the display name of an account, resolved for
  whoever is looking.
- **The form's scalars are `url={false}`** so a half-typed amount never travels
  in the link the next person opens, and `reset="item amount spent_on"` clears
  them on success only.
- **`{$_me ? … : <SignIn>…</SignIn>}`** gives a guest the door instead of a
  button that refuses. `<SignIn>` returns to this page, so they land back where
  they were.
- **Balances are computed in SQL**, never typed. The page holds no arithmetic.

## Forking one

Forking a page copies the datasets it WRITES under your account — rows, columns,
access and write policy — and repoints the page at your copies; datasets it only
reads keep their `ref:`, because copying a live source would freeze it.

## Three mistakes to skip

1. **Typed names.** A `person` column of strings, or a `<Select>` of names you
   invented, cannot tell two Alices apart, cannot say who is reading, and
   refuses nobody. Use `type="user"` and `$_me`.
2. **Seed rows.** A row invented to make the table look alive is a fake person
   in a real list — and an empty stored `<Table>` with declared `columns` is
   accepted, so there is nothing to work around.
3. **A flag left in the link.** A draft or scratch `<Value>` without
   `url={false}` is copied into the URL a reader shares, and arrives as somebody
   else's half-finished input.

## Before you hand it over

A push proves the markup and the read queries; it proves NOTHING about a button.
Run each write once in a live session as yourself and once `--as guest`
([live sessions](live-sessions.md)): join, add an expense, read the balances
back, and check that the guest is offered a sign-in instead of an error. Fix and
push again until one pass is clean.
