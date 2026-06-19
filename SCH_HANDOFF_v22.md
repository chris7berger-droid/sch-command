# SCH_HANDOFF_v22 — PLAN terminal · Billing Redesign & Deposit Phase 2 Build Order

**Repo:** sch-command (cross-app: deposit work touches sales-command-owned `proposals`/`invoices`) · branch `feat/billing-forecast`
**Author:** PLAN terminal (T1)
**Date:** 2026-06-19
**Plan produced:** `docs/plans/billing_redesign_buildorder.md` (committed `d40cf81`, pushed)
**ERD:** Loop #36 (billing-back log items) — **OPEN**, closes when the deposit flow is live
**Pipeline:** **#1 plan (this doc)** → #2 `/auditcriteria` + `/runaudit` (recommended next) → #3 build → #4 buildvsplan

This session ordered the remaining billing backlog (BF-1…9 + ADJ-1…7) into a durable build sequence, grounded in actual code, not backlog prose.

---

## 1. What this terminal did

Took the loose billing backlog and produced a **code-grounded, strategically ordered plan**. The order principle: **data model → spine → features → cleanup**, so we never bridge-then-fix.

The key move: before ordering anything, I read the live code in both repos and contrasted it against the desired goal. That reading **changed the plan** and caught stale prose.

---

## 2. Prose corrections only the code read caught

These are in the plan but worth flagging up top — build off the code, not the old backlog notes:

- **ADJ-3 is already done.** `/billing?tab=worklist` is already routed (`Jobs.jsx:14-20`, `JobsPicker.jsx:72`). Verify + close, no build.
- **The worklist is no longer a "3-column RTB pipeline."** The forecast build already reshaped it to a status-grouped Worklist/Forecast two-tab shell (`BillingWorklist.jsx:10-17`, `Billing.jsx:81-89`). BF-3 reshapes *this*.
- **BF-8's gate is a contained change**, not a spine rebuild — `billingForecast.js:268-293` just lacks a schedule-date gate.
- **No deposit data exists** (confirmed); **retention is a reusable template** for it; invoice "type" is implicit today (archive = null `proposal_wtc_id`, pay-app = `billing_schedule_line_id`).

---

## 3. The strategic shift

The deposit (the loop's proof target) **moved up to Phase 1**, ahead of the card redesign. The code showed its durable foundation — deposit source-of-truth fields, an `invoices.type` column, and the schedule-date gate — doesn't depend on the redesign and it delivers the proof. **Spine-first and proof-first coincide.** Chris ratified.

Build order: **0** corrections → **1** deposit foundation + proof → **2** worklist reshape (BF-3/BF-8/BF-1/BF-2) → **3** nav+polish (BF-5/BF-6) → **4** past-due truth (ADJ-6/BF-7) → **5** forward calendar (BF-9) → **6** cutover cleanup (ADJ-5/ADJ-2/ADJ-7).

---

## 4. Design decisions locked this session

- **Deposit checkbox + amount lives on the Sales `ProposalDetail` summary** (proposal-level data; the WTC wizard is per-WTC so it was the wrong home — would show N times on multi-WTC proposals).
- **Visibility is a hard requirement:** distinct green-accent callout card, not a faint inline control lost in the muted linen UI. (Chris's explicit ask.)
- **`invoices.type` column** (`'regular'|'deposit'|'pay-app'`) recommended over a one-off boolean — unifies the currently-implicit type detection.

---

## 5. Open decisions carried into build (plan §"Open decisions")

1. `invoices.type` column vs boolean — recommend column.
2. `jobs.status` → billing lifecycle card mapping (Phase 2) — design when reached.
3. Gate Sales-side deposit-invoice creation on the job being scheduled, or only gate the Schedule worklist surfacing?
4. Deposit invoice → job linkage confirm (copy-vs-reference; Schedule reads only).

---

## 6. Cross-repo note (don't trip on this)

The deposit's Phase 1 build is **mostly in sales-command** (proposal field, create-invoice flow, invoice label). Schedule only adds the schedule-date gate + reads `invoices.type`. The schema migration (`proposals` + `invoices`) lives in **sales-command** and follows its migration rules — run `scripts/check-migration-safety.sh` + collision check before push. Shared Supabase project `pbgvgjjuhnpsumnowuym`.

---

## 7. State at close

- Working tree **clean**, branch `feat/billing-forecast` **in sync with origin** (plan doc `d40cf81` pushed).
- ERD loop #36 **open** — close with `/erd-close billing-back log items` once the deposit flow works end-to-end.

## 8. Next move (from home / laptop)

```
cd ~/sch-command && git checkout feat/billing-forecast && git pull
```
Open `docs/plans/billing_redesign_buildorder.md`. Recommended: `/auditcriteria` on the plan (it reorders a lot + makes a cross-repo schema call), then `/runaudit`, then build Phase 1.
