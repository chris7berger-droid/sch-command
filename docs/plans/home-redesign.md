# Plan — Schedule Command Home Redesign

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-08-25) — not yet planned. **BLOCKED on mockup asset** (see §6).

---

## The mandate (LOCKED — verbatim from detach brief)

Two separate responsibilities, do not conflate them:

- The **existing Schedule Command Home screen** is the **FUNCTIONAL source of truth.**
- The **supplied mockup** is the **VISUAL source of truth.**

**Failure mode to avoid (happened on the Sales Command redesign):** functional
requirements were met but the visual implementation stayed too close to the OLD app —
the new mockup's aesthetic was not implemented literally enough. Result was heavy
back-and-forth on dark feature backgrounds, warm linen page surface, teal accents, card
proportions, spacing, typography hierarchy, borders, status colors, button styling,
contrast, information density, composition. **Do not repeat that.**

The finished screen must **visually resemble the mockup at first glance** — not the old
Schedule Command screen with beige components rearranged, a few borders/cards added, and
labels changed.

### PRESERVE (functional)
existing data · business logic · actions · permissions · routes · scheduling behavior ·
working components where practical.

### REPRODUCE (visual — from mockup)
overall page composition · dark charcoal **Weekly Crew Capacity** panel · dark charcoal
**Next Up** panel · warm sand/linen page surface · light warm cards · teal highlights &
primary actions · orange/red/purple/green operational signals · condensed bold typography ·
heading sizes & hierarchy · section spacing · card padding · card radius · border weight ·
button proportions · compact day-capacity indicators · horizontal alignment · relative
sizing of the three middle panels · restrained shadows · information density.

### OLD STYLES ARE NOT SACRED
Reuse **logic** aggressively; reuse **visual styling** selectively. Existing CSS/component
styles may be overridden where needed. If a shared component forces the old look, either
(1) add a new variant, (2) restyle it safely, or (3) wrap its logic in a Home-specific
presentation component. Prefer explicit variants (e.g. `<JobCard variant="home-compact" />`)
over globally changing a shared component used elsewhere. Do NOT globally modify a shared
component in a way that changes other screens.

---

## §0 Baseline (observed current state) [TODO — verify before planning]
<!-- Identify the CURRENT Schedule Command Home screen: file(s), route, the components it
     renders, where the data comes from. Read-verify each. This is the FUNCTIONAL contract
     that must be preserved. -->

## §1 Pre-build VISUAL AUDIT [TODO — required before any code]
For each row: state whether the existing implementation can be **reused visually** or must
be **restyled** to hit the mockup. Purpose is to catch visual compromises BEFORE code.

1. Page background
2. Header / navigation
3. Top actions
4. Weekly Crew Capacity treatment
5. Dark feature panels
6. Light supporting panels
7. Typography
8. Color system
9. Spacing
10. Borders / radii / shadows
11. Buttons
12. Job list presentation
13. Compact job-card presentation

## §2 Proposed change [TODO]

## §3 Files to touch [TODO]

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]

## §6 BLOCKER — mockup asset not yet supplied
The detach brief names "the supplied Schedule Command Home mockup" as the visual source of
truth, but **no mockup file/image/artifact was attached** to the detach. Cannot begin the
visual audit or build without it. Need one of: image file, Artifact/Figma link, or the
`.dc.html` design-canvas. Until then this stays PARKED.

## §7 After-build VISUAL VERIFICATION [TODO — gate for "done"]
Run the app, compare rendered screen to mockup. Must confirm: Weekly Crew Capacity is
actually charcoal/black · Next Up is a dark feature card · surrounding workspace is warm
sand/linen · teal accents in the same visual role · same hierarchy · comparable card
proportions, whitespace, typography · controls compact (not the old oversized toolbar) ·
screen immediately reads as the NEW mockup, not the old screen. Functional success alone is
NOT completion. **Functional fidelity + visual fidelity = completion.**
