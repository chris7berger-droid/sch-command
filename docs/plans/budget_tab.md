# Budget Tab — Ideate Output

**Loop:** #40 · SCH-budget-functionality · sch-command · 2026-07-06
**Mode:** ideate (design only — no implementation decisions locked beyond what's below)
**Status:** design closed end-to-end, ready for a plan session.

---

## Purpose

A down-and-dirty, **cost-based** budget that tells you — same-day — whether a job is
earning its bid margin, and links straight to *why*. This is not accounting. It's a
margin guardrail: the alert fires when actual cost passes proposed cost and margin
starts bleeding.

## Placement

Fourth option on the job card, after **Planning · Management · Details → Budget**.
Same spacing and visual treatment as the existing three tabs. (Card already renders
header / job / customer / three work-type bubbles + the three tabs.)

## Data sources (all already exist)

- **Bid side = the WTC (Work Type Calculator)** — one per work type. Carries burden
  rate, OT rate, regular/OT hours, labor cost, material cost, **Total Cost**, and
  profit margin. Frozen at the sale.
- **Day distribution = the Field SOW** — Days → tasks (planned %) → planned hours
  (one lump per day) → planned materials. The frozen calendar the bid is spread across.
  "Scope is frozen from the sale; editing the SOW never changes the bid."
- **Actual side = Field Command** (once connected) — time-clock regular/OT punches
  (dated), material usage, added materials, task completion / PRT production.

## Core model — cost vs. cost

- The guardrail is **Total Cost**, not price. As actual cost climbs toward bid cost,
  the bid margin shrinks in real time. Cross bid cost → margin is bleeding.
- **Planned cost = SOW day-hours × the WTC's blended labor rate**
  (blended rate = WTC labor cost ÷ WTC total hours).
  - Honors the bid's regular/OT mix without requiring the SOW to split reg/OT.
  - Every day's planned cost sums back to exactly the WTC labor cost — the project
    baseline reconciles to the real bid.
- **Actual cost = true punched regular/OT + real material cost.** OT reality lands on
  the actual side, where it belongs; planned stays the bid's honest target. Apples to
  apples at the cost line.

### Why the blended rate (worked example — Heavy Patching WTC)

- Bid: 70 reg @ $58.50 + 80 OT @ $87.75 = **$11,115 labor cost** over **150 hours**.
  53% of bid hours are OT → blended rate = 11,115 ÷ 150 = **$74.10/hr**.
- SOW plans Day 1 as a 30-hr lump. Crew works 30 hrs = 24 reg + 6 OT →
  actual = 24×58.50 + 6×87.75 = **$1,930.50**.
- Benchmark at pure regular rate ($58.50): planned = $1,755 → shows RED (false — the
  crew ran leaner OT than the bid assumed). Summed over the job this baseline is
  $8,775, *below* the real bid — nearly every job would read over.
- Benchmark at blended $74.10: planned = $2,223 → GREEN (correct). Sums to $11,115.

## Layout

Reuse the WTC format almost as-is; add an **Actual** column. Per-work-type panel, with
a job-level roll-up on top.

```
BUDGET · <Work Type>                     [ Today · By Day · Project ]
Burden $/hr   OT $/hr                     ⬤ Today   ⬤ Project
                       BID        ACTUAL      Δ
  Regular hours        —            —         —
  Overtime hours       —            —         —
  Labor cost           —            —         —
  Materials            —            —         —
  Added materials      —   (bid $0) —         —
  ──────────────────────────────────────────────
  TOTAL COST           —            —         —
  Margin               —            —         —
  Why off?  → PRT · Daily Log
```

## Status logic — two dots, leading + lagging

- **Today** (green / red): red when today's actual cost > today's planned cost
  (SOW day plan × blended rate). This is the early-warning signal — a run of red Today
  dots is the heads-up that Project is trending over.
- **Project** (green / yellow / red):
  - **Green:** actual cost ≤ bid cost — earning planned margin.
  - **Yellow:** over bid cost by up to 10% — margin nicked, recoverable.
  - **Red:** over by more than 10% — margin seriously cut.
- Both dots shown together up top, so "over today, under project" reads at a glance.
  Today is the leading indicator, so no pre-crossing yellow is needed on Today.

## Rules

- **Added materials** (not on the bid) = pure overage against a $0 bid line; they eat
  margin visibly. Change orders are a separate flow — explicitly **out of scope** here.
- **Multiple WTCs per day** → the day view aggregates; scroll / paginate the per-WTC
  rows underneath. Today's dot rolls them up.
- **"Why off?"** is always one click to the **PRT** and the **Daily Log** — the two
  things that explain an overage.

## This loop's buildable slice (Field Command not yet connected)

Render the **Bid side live from WTC data** — burden/OT rates, regular/OT hours, labor
cost, materials, Total Cost, margin — with the **Actual** column present but pending,
structured so Field data drops in cleanly later. Satisfies the point-at:
*open Budget, see the proposal details pulled in.*

## Dependencies for the Actual side (Field Command work, later)

- Time-clock punches **tagged to work type** (to slice actual cost by WTC).
- Material-usage logging (planned vs. used, plus added materials).
- The **PRT % feed** for task completion / production, powering the "why."

## Launch context

Schedule Command is not live to anyone but Chris yet. Plan: finish Field Command,
connect the two, then launch Schedule Command + Field Command together — so this is
designed for the real (option B, earned-value) model, no throwaway interim.
