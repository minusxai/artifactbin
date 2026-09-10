---
name: templates-plan
description: Plan skeleton, wireframes, flows and completion tracking.
order: 5
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats: [[ template.beats | join(' → ') ]]

For a UI plan, draw the proposed screens before explaining implementation.
Include low-fidelity wireframes and a screen-transition diagram: a screen
inventory or prose about layout cannot substitute for seeing the interface.
Adapt the example to the user's product; honor a narrower requested scope.

Publish with `template: "plan"`. For operational plans, use process and
dependency diagrams in place of screens. Keep both useful during execution.
Give drawings room; do not squeeze them into report-column thumbnails.

Use this order: primary journey → screen wireframes → transitions and states
→ decisions and milestones. Keep screen IDs consistent across drawings,
arrows, state tables and implementation tasks. Show desktop/mobile layout
differences when relevant, including where navigation and primary actions move.
Draw important error/empty variants beside their normal screens; document
remaining loading, validation, success and recovery behavior in a compact table.

## Contents

Skeleton · Rules · Transitions and completion.

## Skeleton

Static HTML/CSS boxes are wireframes, not a functioning app. Label mock
controls as part of the drawing; only use real buttons when implementing a
working prototype. Use the product's actual content and meaningful control
labels. The following appointment example illustrates spatial layout, a
mobile adaptation, and an error variant; expand it to the requested journey.

```jsx
<div data-design="tw" className="@container bg-background px-5 py-8 text-foreground @3xl:px-10">
  <header className="border-b-2 border-primary pb-5">
    <p className="font-mono text-xs uppercase tracking-widest text-primary">Product design · Review draft</p>
    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Appointment booking — UI plan</h1>
    <p className="mt-3 max-w-2xl text-muted-foreground">Choose a time, review details, confirm. Scope: booking and conflict recovery.</p>
  </header>
  <h2 className="mt-8 text-xl font-semibold">01 · The proposed screens</h2>
  <figure className="mt-6">
    <div className="grid min-w-0 grid-cols-1 gap-6 @3xl:grid-cols-2">
      <div className="min-w-0 border border-border p-4">
        <p className="text-xs font-mono">S1 · Desktop · Choose a time</p>
        <div className="mt-3 border-b border-border pb-2">Clinic / Appointments / New</div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <aside className="border border-border p-2">Visit type<br />Consultation<br />30 minutes</aside>
          <div className="col-span-2 border border-border p-2">
            <p>Tuesday · Available times</p>
            <div className="mt-2 flex flex-wrap gap-2"><span className="border border-border p-2">09:00</span><span className="border-2 border-foreground p-2">10:00 selected</span></div>
            <p className="mt-3 border-t border-border pt-2">Selected: Tuesday 10:00</p>
            <p className="mt-2 border border-foreground p-2">Continue → S2</p>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-xs border border-border p-4">
        <p className="text-xs font-mono">S1 · Mobile</p>
        <p className="mt-3 border-b border-border pb-2">← Back · Choose a time</p>
        <p className="mt-3">Consultation · 30 min</p>
        <p className="mt-3 border border-border p-2">Tuesday ▾</p>
        <p className="mt-2 border border-border p-2">09:00</p>
        <p className="mt-2 border-2 border-foreground p-2">10:00 selected</p>
        <p className="mt-6 border border-foreground p-2">Bottom action: Continue → S2</p>
      </div>
    </div>
    <figcaption className="mt-2 text-sm">Desktop keeps visit details beside slots; mobile stacks them above a bottom action.</figcaption>
  </figure>
  <figure className="mt-6 max-w-sm border border-border p-4">
    <p className="text-xs font-mono">S2 · Error variant</p>
    <p className="mt-3">Review appointment · Tuesday 10:00</p>
    <p className="mt-3 border-2 border-foreground p-2">This time was just booked. Your visit details are kept.</p>
    <p className="mt-3 border border-foreground p-2">Choose another time → S1</p>
    <figcaption className="mt-2 text-sm">Conflict recovery replaces the confirm action.</figcaption>
  </figure>
</div>
```

## Rules

Plans with at least three h2 sections get the same side contents rail as
editorial documents on wide screens. Author semantic h2/h3 headings; the
platform supplies navigation. The rail is omitted from captures.

Compose a working board: wide drawing areas, quiet margins, short adjacent
annotations, and a compact milestone ledger. Use one accent for screen IDs,
arrows and active status; use text and shape as well as color. Align drawings
on a shared grid and vary their size by importance. On narrow containers,
use `grid-cols-1` before wider column variants and `min-w-0` on panels.
Stack screens in journey order with readable labels. Wide desktop drawings
need a bounded `overflow-x-auto` region and a visible scroll hint. Check
the document surface itself for clipping, not just the page scroll width. Keep prose to decisions
and explanations that the drawings cannot carry.

Do
- Show actual content, navigation, primary actions and meaningful state variants.
- Label each screen and connect it to the flow; give each milestone an acceptance criterion.

Don't
- Substitute a component inventory for wireframes, or a task timeline for screen transitions.
- Add decorative device frames, giant heroes or tiny diagram labels.

## Transitions and completion

Draw screen flows with `<Mermaid>` (see [markup-svg.md](markup-svg.md));
inline SVG or connected HTML panels suit bespoke diagrams. Label arrows with the triggering action;
include back/cancel and relevant error/retry branches. For this example:
S1 — Continue → S2 Review — Confirm → S3 Confirmation;
S2 — Slot taken / choose another → S1; S2 — Back → S1 with selection retained.
Render those relationships as a diagram, not just this text sequence. These
are user screen transitions, separate from implementation dependencies.

Use a table for states: screen | trigger | visible change | next action |
data retained. Distinguish saving from saved, and a recoverable error from
an empty result. Animations are optional; explaining navigation is essential.

Milestones use plain lists or tables, without checkboxes. Strike completed
task labels: `<td><s>Review booking wireframes</s></td>`; leave pending labels
unstruck. Status text may distinguish Pending, In progress and Done. Preserve
owners, dependencies and acceptance criteria. Only mark work complete when
the user reports it or you have verified it. Persist progress through document edits.
