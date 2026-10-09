---
name: templates-plan
description: >-
  The plan page type: the reader's job, three compositions the thesis chooses between, what the runtime needs for drawings, flows and the ledger, and the rules.
order: 5
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

A plan is read by two readers: an agent that will execute it and a person
who will review and update it. Draw the proposal before explaining it:
screens, invariants or process diagrams, then contracts, then tasks. The
design system owns the wireframe hand, the status tags and the ledger rule
(its reference carries a plan specimen when it fits); the thesis owns which
drawing leads. Pick ONE composition and build that. Publish with
`template: plan`; honor a narrower requested scope.

## Compositions

- **Engineering drawing set.** The main invariant or the proposed screen
  leads as a drawing; then module, API and data contracts, dependencies and
  evidence-aware tasks. For adding a capability to an existing system.
  Rejected default: a task list with a timeline and no drawings.
- **Release runbook.** Ownership boundaries, readiness checks, failure and
  recovery paths and a clear execution order; the flow diagram leads. For
  shipping or operating something that already exists.
- **UI plan.** The primary journey as low-fidelity wireframes (desktop and
  mobile, error and empty variants beside their normal screens), a
  screen-transition diagram, a state table, then decisions and the ledger.

## What the runtime needs

- Three or more `<h2>` sections get the same contents rail as editorial pages
  on wide screens; author semantic headings, the platform supplies navigation.
- Flows are `<Mermaid>` ([markup-svg.md](markup-svg.md)): label arrows with the
  triggering action, include back, cancel, error and retry branches. Screen
  IDs stay consistent across drawings, arrows, state tables and tasks.
- Wireframe drawings are static HTML and CSS boxes or inline SVG drawn in the
  system's hand; label mock controls as part of the drawing. Wide drawings
  get a bounded `overflow-x-auto` region. If the user wants to click through
  a flow and review its states, build an interactive `template: app` prototype
  whose screens, tabs and dialogs native comments restore
  ([saved comment views](review-state.md)). Static drawings need nothing.
- The ledger is a table: owner, dependencies, status, acceptance. Completed
  task labels are struck (`<s>`), never deleted; no checkboxes. Mark work
  complete only when the user reports it or you verified it; persist
  progress through edits.

Skeleton of the runtime pieces (publishable as is; the proposal is yours):

  <div data-design="tw" className="@container px-5 py-8 text-foreground @3xl:px-10">
    <header className="border-b-2 border-primary pb-5">
      <p className="t-label">Product design · Review draft</p>
      <h1 className="t-display-m mt-3">Appointment booking — UI plan</h1>
    </header>
    <h2 className="t-title mt-8">01 · Proposed screens</h2>
    <figure className="mt-6 grid min-w-0 grid-cols-1 gap-6 @3xl:grid-cols-2">
      <div className="min-w-0 border border-border p-4"><p className="t-label">S1 · Desktop · Choose a time</p><p className="mt-3 border border-foreground p-2">Continue → S2</p></div>
      <div className="mx-auto w-full max-w-xs border border-border p-4"><p className="t-label">S1 · Mobile</p><p className="mt-3 border border-foreground p-2">Bottom action: Continue → S2</p></div>
    </figure>
    <h2 className="t-title mt-8">02 · Transitions</h2>
    <Mermaid title="Screen transitions" code={`flowchart LR
      A[S1 Choose a time] -->|Continue| B[S2 Review]
      B -->|Confirm| C((S3 Confirmed))
      B -->|Slot taken| A`} />
    <h2 className="t-title mt-8">03 · Execution ledger</h2>
    <table className="text-sm"><thead><tr><th>Task</th><th>Owner</th><th>Status</th></tr></thead><tbody><tr><td><s>Wireframes reviewed</s></td><td>Design</td><td>Done</td></tr><tr><td>Conflict recovery screen</td><td>App</td><td>Pending</td></tr></tbody></table>
  </div>

## Rules

Do
- Show actual content, navigation, primary actions and meaningful state
  variants; label each screen and connect it to the flow.
- Give each milestone an acceptance criterion; distinguish discovery from
  implementation from verified results. All implementation tasks start pending.
- Consistent system roles for screen IDs, arrows and active status; text
  and shape as well as colour.

Don't
- Substitute a component inventory for wireframes, or a task timeline for
  screen transitions.
- Decoration that obscures the proposal, tiny diagram labels; prose the
  drawings already carry.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
