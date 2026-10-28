---
name: templates-app
description: >-
  The app page type: a tool people operate, three compositions the thesis chooses between, what the runtime needs for state, actions and identity, and the rules.
order: 6
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

An app is operated, not read: the thing people act on is the primary
surface, the selection stays visible while they decide, and every action
ends in a record they can see. Empty, unavailable, error and success states
are designed, not accidental. The design system owns the toolbar, the row
rhythm, the status tags and the primary button (its reference carries an
app specimen when it fits); the thesis owns what the primary surface is.
Pick ONE composition and build that. Publish with `template: app`.

## Compositions

- **Sheet.** Availability is the primary surface (slots, machines, seats);
  the selection stays visible beside it; confirmation becomes a booking
  record. For claiming things. Rejected default: a form with a submit button
  and a success toast.
- **Drawer.** Browse and compare items with a persistent shortlist tray and a
  receipt-style review that keeps count and total honest. For choosing among
  many things with a budget or a limit.
- **Console.** A toolbar, rows with status, and a form; what needs attention
  reads at a glance and every row has its action. For operating something
  that runs.

## What the runtime needs

- Markup-bound state uses `<Value>`s in `<Helmet>`; controls write them,
  conditions and `For` read them. Custom scripts can use ordinary Solid
  local state. A stored write is a `<Mutation>` over an imported dataset with
  `expectedAffected`, run by `<Button run="$name">`. Define the transitions
  before the screens.
- Interactive wireframes and apps for design review keep the state that
  determines the view in Values, kit controls or named signals
  (`createSignal(initial, { name })`); native comments then restore screens,
  tabs and dialogs. Follow [saved comment views](review-state.md).
- A page several people use is built from [apps.md](apps.md): accounts,
  grants and mentions, never typed names; `User` and `SignIn` when identity
  matters. A local prototype with page-local state is a different thing from
  a shared dataset-backed app; say which this is.
- Test every new or changed `<Mutation>` in a live session, once as yourself
  and once `--as guest` ([live-sessions.md](live-sessions.md)). A control
  that silently does nothing is a defect, not a placeholder.

Skeleton of the runtime pieces (publishable as is; the surface is yours):

  <Helmet>
    <Import name="tasks" src="ref:ntf123" />
    <Value name="task_id" type="number" default={1} />
    <Value name="status" type="string" default="Done" />
    <Query name="open">{`select id, title, status from tasks.rows order by id`}</Query>
    <Mutation name="change_status" expectedAffected={1}>{`update tasks.rows set status = $status where id = $task_id`}</Mutation>
  </Helmet>
  <div data-design="tw" className="@container px-5 py-8 text-foreground">
    <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
      <h1 className="t-title">Workshop · Sign-out sheet</h1>
      <Button run="$change_status">Mark done</Button>
    </header>
    <DataTable data="$open" rowKey="id" height="240px" />
  </div>

## Rules

Do
- Show unavailable, empty and success states; keep the selection when the
  reader navigates back; provide a working clear or undo.
- Keep counts and totals computed from the same data the rows show; an item
  appears once.
- Say whether refresh resets or retains the demo, and label demo data.

Don't
- A placeholder control; invented availability; a demo that pretends to
  reserve a real seat or take a payment.
- Decoration that hides the working surface or competes with its primary action.

Components: [markup.md](markup.md); data and actions: [markup-data.md](markup-data.md).
