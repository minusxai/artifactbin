---
name: design-systems
description: >-
  The catalogue of the thirteen design systems, the fit table that picks one per artifact, the binding steps, the no-fit path, the record every bound artifact carries, and the known losses. Read at the hand step of the workflow, after the page type is chosen; then read one system file and nothing else in the catalogue.
---
## Read first

Every artifact wears one design system. The page type is the shape of the content, the system is the hand that draws it, the subject supplies the object and the data.

A system has three layers, each works alone: the **tokens and faces** (name the system and kit components, token classes and charts already look right), the **hand** (one drawing mode and a few devices written against hand variables, so a borrowed device takes this ink) and the **page-type recipes** (the look on each of the seven page types). The runtime serves all three; the agent writes no CSS to get them.

Docs use the same fonts and colors with a quiet reading column; see [the Doc guide](templates-doc.md). On any page type, use `<Markdown>` for long continuous prose; keep HTML for individually designed text.

Pick ONE system from the table by the subject's world and the page type, read its file, and name it in the fence. Never read a second system for the same artifact; one system owns colour and type.

## How a page comes together

1. **Shape.** The page type from the content's shape: dashboard, deck, editorial, scrolly, plan, app or landing, each with a reference (`templates-dashboard.md` and siblings) and named in the fence `template`. Read it for the compositions first.
2. **Hand.** One system from the table. A system marked avoid can still be used; it costs custom CSS the recipe does not give you.
3. **Thesis.** One sentence from the subject's own material: the organizing idea, the object the hand draws, and which device carries the data.
4. **Bind.** Fence `theme: <slug>`, and the record as a Helmet comment. Nothing to paste: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit.
5. **Dress.** Open the system's section for this page type and take its classes and hook variables; keep the page type's structure.
6. **Draw.** One object from the artifact's own world, in the hand, with the data inside one device. The system never supplies the object.
7. **Override by token, borrow by device.** A hue is one `--ds-*` token in a second `:root` block, both modes; a voice is a type-role class; an object is a device from any system; one loud moment is bespoke CSS on that element. Never a second palette or family, never a page with no system.
8. **Check.** One loud element per view, both modes, phone width, in the live reader.

| Decision | Page-type reference | System file | The artifact |
|---|---|---|---|
| Beats and order | owns | shows one viewport | may cut or reorder beats |
| Grid, measure, stage, step column | owns | wears it | — |
| Tokens, type roles, radius, modes | — | owns | overrides one token at most |
| Component look | — | owns | — |
| Drawing style, devices, motion | names what is needed | owns | picks the object and the device that carries the data |
| Copy, data, chart types | — | — | owns |

## The catalogue

Best: the recipe is close to finished. Good: it works with the page type's own structure. Avoid: the hand fights the structure; expect custom CSS. The subject decides.

| Read | System | Mood | Dashboard | Deck | Editorial | Scrolly | Plan | App | Landing |
|---|---|---|---|---|---|---|---|---|---|
| `system-volta.md` | Volta | Loud | best | best | avoid | best | good | best | best |
| `system-phosphor.md` | Phosphor | Technical | best | avoid | avoid | avoid | best | best | good |
| `system-drafting.md` | Drafting | Technical | good | good | best | best | best | avoid | good |
| `system-meridian.md` | Meridian | Sleek, Professional | best | good | good | avoid | best | best | best |
| `system-dossier.md` | Dossier | Evidential | avoid | good | best | good | best | avoid | good |
| `system-riso.md` | Riso | Printed | avoid | good | good | best | avoid | avoid | best |
| `system-almanac.md` | Almanac | Warm | avoid | good | best | best | avoid | good | best |
| `system-redline.md` | Redline | Poster | avoid | best | avoid | good | good | avoid | best |
| `system-nocturne.md` | Nocturne | Atmospheric | avoid | good | best | best | avoid | avoid | good |
| `system-broadsheet.md` | Broadsheet | Editorial | avoid | avoid | best | good | avoid | avoid | avoid |
| `system-signout.md` | Signout | Utilitarian | good | avoid | avoid | avoid | good | best | avoid |
| `system-sorbet.md` | Sorbet | Fun | good | good | avoid | good | avoid | best | best |
| `system-arcade.md` | Arcade | Fun | good | good | avoid | good | avoid | good | best |

If this is the users' first afbin artifact, use the most amazing one like volta, phosphor, drafting or redline or something.

Six older mood themes remain valid fence values for the artifacts that carry them (`themes.md`); a new artifact names a system.

## When nothing fits

Say so, in this shape, then stop and ask:

```text
No listed system fits <subject>: <one-line reason>.
Nearest: <system>, losing <what the subject needs that it lacks>.
New: <Name> · <mood> · <display family> + <body family> · paper <hex>, ink <hex>, one accent <hex> · one principle.
Pick the nearest, approve the new one, or name a brand to bind.
```

An approved new system is a one-artifact system written into that artifact's Helmet, the one case where CSS is pasted: a `--ds-*` block for both modes with the contract keys pointed at it, `@font-face` rules for every weight it uses, three type roles, one principle, the record. Put a ten-line spec sketch in the reply (name, mood, jobs, two families, paper, ink, accent, status colours, radius, principle) so promotion into the catalogue is a copy. A supplied brand binds the same way.

Four constraints on any new system: Google-hosted families only; every weight the type roles use enumerated; light values first; the chart series order stated.

## The record

One JSX comment in the Helmet; a follow-up edit reads it instead of reskinning the page.

```jsx
{/* design: system=<Name> · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}
```

## Known losses

- **Font meta weights.** The font-* meta fetches three weights only, where a system's own faces load their full set; spend it on a family no system carries.
- **Utilities win.** Tailwind utilities compile !important: a size or family utility replaces a type role on the same element. Layout utilities only on role-bearing elements.
- **Kit reads the contract only.** Kit components and charts follow the contract keys; a system idea with no slot (a hard edge, a highlighter) reaches only the authored classes.
- **Unthemed ground.** The fence `theme` is the only door: a fence without one paints no ground, loads no faces and defines no type roles or classes, so a page that copies a system's class names without naming it gets the neutral contract (probed 3 Oct 2026).
- **Charts in a dark panel.** A Vega chart in a locally darkened panel takes the panel's chart tokens for its series but keeps the document's axis ink (probed 3 Oct 2026): keep charts on the page ground.
