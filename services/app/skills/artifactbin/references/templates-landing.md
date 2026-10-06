---
name: templates-landing
description: >-
  The landing page type: one offering and one next action, three compositions the thesis chooses between, what the runtime needs, and the rules.
order: 7
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

A landing page has one job: make the offering and the next action instantly
clear to someone who arrived knowing nothing, and let them choose. The
atmosphere comes from the subject (its drawing, its vernacular), never from
a generic hero. The design system owns the headline, the device drawing and
the pair of buttons (its reference carries a landing specimen when it fits);
the thesis owns what the opening is made of. Pick ONE composition and build
that. Publish with `template: landing`.

## Compositions

- **Invitation.** One subject-led image or drawing with the dates, the price
  and the next action composed into the opening; the detail below is short.
  For an event, a series, a place. Rejected default: a centered headline over
  a three-column feature grid.
- **Programme.** The schedule organizes the page: sessions or workshops as
  the primary surface, visually distinguished so a visitor can choose, with
  a details interaction per item. For anything with a timetable.
- **Product story.** A headline that states the benefit, a device or object
  drawing, a pair of actions, then two or three features that each earn
  their place. For a tool or a service.

## What the runtime needs

- The primary action reaches the thing it promises: a link to the schedule
  section, a `<Button>` that opens a `Dialog` with the details, or a `set`
  on a `<Value>` the page reads. Nothing that silently does nothing.
- A booking or sign-up is explicitly a demo unless the page is built from
  [apps.md](apps.md): no payment, no personal data, no invented availability,
  no pretence that a demo reserves a real seat.
- Images are `<img src="ref:<id>" />` or an `https://` URL imported at
  publish; the subject's drawing is inline `<svg>` in the system's hand.

Skeleton of the runtime pieces (publishable as is; the opening is yours):

  <Helmet><Value name="session" type="string" /></Helmet>
  <div data-design="tw" className="@container px-6 py-12 text-foreground @2xl:px-12">
    <header className="grid grid-cols-1 gap-8 @3xl:grid-cols-[3fr_2fr] @3xl:items-center">
      <div className="min-w-0">
        <p className="t-label">After Hours · Four Fridays in October</p>
        <h1 className="t-display-xl mt-4">Forty seats, one lamp, no phones.</h1>
        <p className="t-body-l mt-5 max-w-prose">Doors at seven, music at eight, twenty-five a seat.</p>
        <div className="mt-8 flex flex-wrap gap-3"><a href="#sessions" className="v-btn v-btn-primary">Explore sessions</a></div>
      </div>
      <svg viewBox="0 0 480 240" className="w-full"><title>The room, drawn</title><rect className="h-ground" x="40" y="40" width="400" height="160"/><circle className="h-fill" cx="240" cy="120" r="24"/></svg>
    </header>
    <section id="sessions" className="mt-16">
      <h2 className="t-display-m">The sessions</h2>
      <Segmented label="Session" value="$session" options={["Oct 2 ambient","Oct 9 jazz","Oct 16 electronic","Oct 23 acoustic"]} />
    </section>
  </div>

## Rules

Do
- The facts (when, where, how much) in the opening, not below the fold;
  one primary action, one secondary.
- Distinguish the items people choose between by treatment, not by a badge.
- Say plainly what the demo does and does not do.

Don't
- A hero without the facts; a feature grid for its own sake; stock imagery
  where the subject has its own object.
- Collect personal data or payment; invent availability counts.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
