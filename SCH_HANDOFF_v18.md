# SCH_HANDOFF_v18 — PLANNING terminal · Billing Triage + 90-Day Cash-Flow Forecast

**Repo:** sch-command (cross-app: reads sales-command-owned `invoices`/`customers`/`billing_schedule`) · branch `feat/billing-forecast`
**Author:** Terminal #1 of 4 — planning (T1)
**Date:** 2026-06-18
**Plan:** `docs/plans/billing_forecast_integration.md` (build-ready, HEAD `3667403` at convergence)

The 4-terminal pipeline this round: **#1 plan (me) → #2 audit (/runaudit) → #3 build → #4 buildvsplan**. This doc is the **planning terminal's perspective** — the decisions, the forks, and the landmines that only T1 had full sight of, captured for the handoff history before #4 closes out. Each terminal contributes its own view; this is mine.

---

## 1. What this work actually is (the framing only planning made)

Chris brought a proven Excel tool ("YES 2026 Weekly Billing Checklist & Breakdown") that ran his billing well until he lost the staff who operated it. The planning insight that shaped everything downstream: **it's two tools fused** — (a) a **weekly billing triage worklist** (per-job status: ready/sent/sent-to-QB/hold/nothing/paid), and (b) a **90-day cash-flow forecast** (sent-date + terms → expected pay date → weekly inflow buckets). 

Where it fits: the **seam between "work got done" (Schedule/Field) and "invoice went out" (Sales engine)**. That seam is the "ready to bill" surface, and nothing in the suite forecasts cash. So this is a genuine gap, not a duplicate of Sales Command's invoice machinery. **The forecast is the prize** — that framing is why Option 2 (below) stayed viable as a fallback: the worklist is the harder, bug-dense half; the forecast is the value.

---

## 2. The decisions T1 locked (and who actually owned them)

These were **Chris's product calls**, surfaced in plain English for ratification — not architecture I chose:

- **Cards (All Jobs screen):** Ready-to-Bill → **REPLACE** (worklist subsumes it; tile stays as entry point) · Production-Complete → **SYNCHRONIZE** (keep the stage card, rewire its money footer to the worklist's needs-triage count) · Budget → **INFUSE**, then **DEFERRED** to fast-follow at round 2 (revenue side only; margin needs Field DPR cost data).
- **Retention:** **5% default, customizable** (corrected from my initial 10% assumption — [[project_retention_default]]). Forecast is **NET of retention**; retention reappears as its own invoice when released.
- **Authoritative "fully billed" total:** `billing_schedule.contract_sum` (SOV) where it exists, else proposal `total`. `jobs.amount` (a string) is **never** authoritative.
- **Terms:** default from `customers.billing_terms`, **per-invoice override** allowed (15–90).
- **Legacy `billing_log`:** kept **READ-ONLY, not deleted** (reversible retirement).
- **Scope:** v1 = **live derived worklist**; `weekly_billing_snapshot` designed but deferred.

Single source of truth was the spine: Schedule **reads** canonical invoices directly (one shared DB, RLS read **confirmed safe** in round 1) and **writes back only** operational state (`billing_worklist`: hold/nothing/terms_override/notes).

---

## 3. The fork that mattered: Option 1 vs Option 2

Round 1 surfaced a defect cluster (8 of 24 findings) in the fully-billed / All-Ready-Billed derivation. The audit offered **Option 1** (patch the status logic in v1) vs **Option 2** (defer fully-billed; ship Needs-billing/Sent/Paid + forecast). 

**I chose Option 1**, for reasons only planning could weigh: (a) the Excel tool's "All Ready Billed" status is part of the **named surface Chris pointed at** — deferring it shrinks his ask ([[feedback_user_intent_locked]]); (b) the audit handed a **bounded** punch-list (A1–A5/B1–B3), so it was "build it right," not open-ended risk; (c) the prize (forecast) ships either way. Option 2 stayed armed as the plateau fallback. It was never needed — the loop converged.

---

## 4. The convergence and the lesson worth keeping

**Trend: 24 → 13 → 1.** Three audit rounds, clean Option-1 landing. Plan grew 492 → 819 → 967 (+66% then +18% — decelerating, the signature of convergence, not scope creep).

**The lesson (this loop's central insight):** revision pass 1 was written **from the plan's prose, not the code**, and round 2 caught **3 regressions** where the plan asserted code facts that were wrong (pay-app `amount` is GROSS not net; canonical `getMonday` lives in exports.js not Billing.jsx; the footer count is in JobsPicker's memo not the parent). Pass 2 **re-verified every fix against live source** — and that broke the regression cycle. Even round 3's single finding was a false census claim (4 `getMonday` copies → actually 8). 

→ Codified as [[feedback_revise_against_code_not_prose]]. It applies to the **build** too: when #3 reads this plan, the plan's wording is a pointer, not gospel — verify against source. The two prose-vs-code catches (REG-1 pay-app gross, N4 `set_updated_at` clobber risk) were both cases where the audit's *own* asserted facts were wrong until checked against code.

---

## 5. What T1 deliberately left OPEN (for /erd-start, not for the audit)

Three questions rode through all three rounds unresolved **by design** — they're product calls for the build lock, never blockers:

- **Completion signal (§3.3)** — the load-bearing one. What counts as "had work this week" drives the entire worklist population. Chris ran it off "end date this week"; we can keep that or upgrade to DPR-approved/WTC-complete. **Settle this at `/erd-start`.**
- **Portal-submitted nuance (§3.1)** — fold "submitted to customer portal" into "Sent to QB" (no DB field exists), or track separately. Likely fold.
- **Hold–Sales role-gating (§9-queue)** — role-gated to sales, or open to all Schedule users.

---

## 6. The landmines T1 flagged for the build (what to get right)

- **Multiple invoices per `call_log`** — COs, retention-release, and pay-app invoices all FK the same call_log; the fully-billed sum and one-row-per-job grain (§3.0a) must not double-count.
- **Multi-proposal call_logs** — archive + live, multi-GC; `authoritative_total` must pick the **live non-archive** proposal, degrade to Needs-Triage when ambiguous.
- **Two retention conventions** — active `retention_*` vs legacy `retainage_*`; net math must read the canonical one. (ADJ-1 — now **verified forecast-safe** at build start: 0 live invoices have retainage without a correct retention_amount.)
- **`tg_set_updated_at` not `set_updated_at`** — use sch-command's own function; do NOT `CREATE OR REPLACE` the sales-owned one (clobber risk).
- **Pagination** — invoice reads via `loadAllRows` (PostgREST 1000-row cap).
- **billing_log reader census** — §5.2a listed 9 sites; the build (#3) found it **understated** (StageJobCard, urgencyScore, card-list forwarding also touched). A census claim is itself a code fact — verify it (see §4).

---

## 7. State at handoff & the adjacent backlog

- **Plan:** build-ready, no round-4 audit. **Build + buildvsplan have since run** (#3/#4, 2026-06-18) — see their handoff perspectives for build state.
- **Backlog:** created sch-command's first `docs/BACKLOG.md` — 6 adjacent findings from the loop (ADJ-1..6), filed per audit scope discipline rather than folded into the build. #3 added ADJ-7 (remaining billing_log reader retirement). ADJ-1 verified forecast-safe; ADJ-6 confirmed real by Chris (partial *payment* of non-GC invoices, distinct from partial *billing*).
- **Decisions captured in memory:** [[project_billing_forecast_integration]], [[project_retention_default]], plus the two process lessons ([[feedback_revise_against_code_not_prose]], [[feedback_audit_cap_not_a_choice]]).

**Planning verdict:** the plan↔audit loop did its job — it caught 3 regressions that would have shipped silently and forced the prose-vs-code discipline that the build then inherited. Option 1 held start to finish; the named surface was preserved, not truncated.
