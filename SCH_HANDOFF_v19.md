# SCH_HANDOFF_v19 — AUDIT terminal · Billing Triage + 90-Day Cash-Flow Forecast

**Repo:** sch-command (cross-app: reads sales-command-owned `invoices`/`customers`/`billing_schedule`/`proposals`/`tenant_config`) · branch `feat/billing-forecast`
**Author:** Terminal #2 of 4 — audit (`/runaudit`)
**Date:** 2026-06-18
**Plan audited:** `docs/plans/billing_forecast_integration.md` · 3 rounds (revisions `167ef3d` → `3e07e89` → `cde83a1` → `3667403` at convergence)

The 4-terminal pipeline this round: **#1 plan → #2 audit (me) → #3 build → #4 buildvsplan**. This doc is the **audit terminal's perspective** — the convergence trajectory, the defect *signatures*, and the one through-line pattern that only an adversary running three rounds against the same plan could see. T1's v18 has the product decisions and the forks; this is the view from the attacker's chair. Companion to v18, not a replacement.

---

## 1. What this terminal was (and the posture that shaped the findings)

Read-only adversary. No edits, no commits to the plan, no touching the [LOCKED] decisions unless I found a concrete defect *in* one. Every round was **sized by the manifest `/auditcriteria` left at the bottom of the plan** — agent count, finding cap (24), attack angles, and the deployment-context severity caps. That sizing is load-bearing: it's why this stayed a *bounded* adversarial pass and not an open-ended hunt ([[feedback_multi_agent_audit_sizing]]).

The single most important severity lever was the **deployment context**: live tenants == 1 (HDSP), billing effectively solo (Chris), and **this surface is not yet load-bearing** (real billing still runs off Excel + QB). That capped cross-tenant findings at Med and multi-user races at Low *by design* — so the report never inflated theoretical multi-tenant attacks on a single-tenant, not-yet-live surface into Highs. Build terminal should keep that frame: the caps were deliberate, not oversights.

Agent count **shrank as the plan converged**: 4 → 3 → 2. That's the audit reading its own signal — fewer novel mechanisms left to attack each round.

---

## 2. The audit's signature artifact: the convergence trajectory

| Round | Revision | Findings (caused-by) | Sev mix | Pattern tag |
|---|---|---|---|---|
| 1 | `3e07e89` | **24** (+3 adjacent) | 2C / 7H / 11M / 4L | `status-derivation-arithmetic` |
| 2 | `cde83a1` | **13** (3 regressions + 10 new, +2 adjacent) | 0C / 4H / 5M / 4L | `prose-patch-regressions` |
| 3 | `3667403` | **1** (1 regression, +1 adjacent) | 1H / 0M / 0L | `false-census-claim` |

**24 → 13 → 1.** A clean −46% then −92% drop. No plateau ever formed (the plateau rule — "round N ≥ prior round → scope-cut to Option-2 only" — was armed every round and never fired). The loop converged on **Option 1** (build the full fully-billed logic), which is what T1 chose at the round-1 fork.

The tension worth flagging: **findings fell while the plan *grew*** — 492 → 819 → 967 lines (+66%, then +18%). By round 3 the plan slightly exceeded the code it specified (~1.1:1). That's the marker I called out at the round-3 gate: further rounds would add plan *bulk*, not risk reduction. It's why I recommended exiting after a one-line correction rather than grinding a round 4. Convergence ≠ "keep polishing until zero."

---

## 3. The de-risk that reframed round 1 (only the audit settled this)

The manifest's #1 blind spot was **whether a Schedule-authenticated, same-tenant user can even SELECT Sales-owned `invoices`/`customers`**. If they couldn't, the entire worklist + forecast render **empty** — the whole feature is a no-op. The plan flagged it as a live-DB check to run later.

The audit settled it **statically, in round 1, from policy SQL** — no live query needed: `invoices_select`/`customers_select` are both `FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id())`, and `get_user_tenant_id()` reads the shared `team_members` table off `auth.uid()` — app-agnostic. A same-tenant Schedule session passes; the only failure mode is fail-**closed** (empty, safe), not a leak. That moved the highest-leverage unknown off the board on day one and let rounds 2–3 focus on math. Build terminal can treat the RLS read as proven, not assumed.

---

## 4. The through-line only three rounds could reveal: prose-patch regressions

This is the finding the audit is proudest of, and the one **no single-round review would have caught**.

- **Round 1** broke the way you'd expect a greenfield money feature to break: the `§3.2 "fully billed"` sum was wrong for *every real invoice type at once* — it summed retention-release invoices (inflating past contract), treated a `contract_sum DEFAULT 0` as a real $0 contract (instant false "fully billed"), counted unsent drafts, and had **no model for change orders being their own `call_log` children**. Two Criticals. A dense but *bounded* cluster — exactly the kind Option 1 can patch.

- **Round 2 is where it got interesting.** The round-1 *fixes themselves regressed.* Three of them (pay-app gross/net prose, the `getMonday` helper-lift target, the "footer derived in parent" claim) were written by editing the plan's **words** without re-reading the **code**. The pay-app gross-vs-net fact literally **flipped twice** across rounds. And a genuinely material bug that had sat in the forecast since the original draft only surfaced when an agent finally read the canonical Sales net formula: **the forecast never subtracted customer `discount`** (`amount − discount − retention`, not `amount − retention`). Over-counts cash on every discounted invoice.

- **Round 3** converged to a single residual — and it was *the same pattern, smaller*: the pass-2 `getMonday` census claimed "4 copies, exhaustive" when **8 exist** (4 of them off the billing surface). Not a math defect; a **false-authority claim** in the plan ([[feedback_confidence_tags_reconstructed]] is the antidote — say what you verified, not what you assume you covered).

**The lesson for the whole pipeline:** a revision pass that patches plan prose without re-verifying against live source manufactures confident, wrong statements. Every round I forced regression checks against actual code first — that's what kept catching it. If T3/T4 revise anything, re-read the source; don't trust the plan's wording, including mine.

---

## 5. What I deliberately did NOT do

- **Never invoked Option-2 defer.** It stayed armed as the plateau fallback all three rounds. Count never approached the ≥13 plateau or ≥10 convergence-miss line, so forcing a scope-cut would have *shrunk Chris's named surface* against the evidence ([[feedback_user_intent_locked]]). The discipline: the cut is the *only* build-prompt option when it fires, and silence when it doesn't.
- **Never re-litigated the [LOCKED] decisions.** The 5% retention default, the `contract_sum ?? proposal.total` authority, the read-only `billing_log` retirement — all Chris-ratified, all left alone. I only touched a locked item when I had a concrete defect (e.g. the `contract_sum > 0` gate inside the locked authority rule).
- **Kept caused-by and adjacent strictly separated** ([[feedback_audit_scope_discipline]]). The 6 adjacent findings never leaked into a build punch-list — they're pre-existing patterns the plan *sat near* but did not cause. They're now filed in `docs/BACKLOG.md` (ADJ-1..6, commit `664a2f3`). **Build terminal: those are backlog, not build scope.**

---

## 6. Landmines for the build/verify terminals (surfaced by cross-repo reads only the audit did)

These came from reading **sales-command's** source/migrations, not just sch-command — the build terminal should not have to rediscover them:

1. **Pay-app invoices are GROSS.** `NewPayAppModal.jsx:186` writes `amount = grossThisBilling`, retention in `retention_amount` separately. The uniform net formula `amount − COALESCE(discount,0) − COALESCE(retention_amount,0)` is correct *because* of that. This fact flipped twice — **read line 186 yourself, don't trust any prose (including mine).**
2. **Use sch-command's own `tg_set_updated_at()`** (`20260528120000:37`), NOT `CREATE OR REPLACE set_updated_at()`. The bare `set_updated_at` is **sales-owned, used by 5+ sibling tables, and its body lives nowhere in tracked SQL** — REPLACE-ing it is a cross-repo clobber on a function you can't see ([[feedback_edge_fn_post_deploy_smoke]] energy: don't trust shared infra you haven't read).
3. **`getMonday` has 8 copies, not 4.** Lift only the canonical (`exports.js`/`Schedule.jsx`/`Daily.jsx`, byte-identical) into `src/lib/weeks.js` — which the build did (`132a64b`). The 4 off-surface copies (`StatsBar.jsx:6`, `Jobs.jsx:29`, `Schedules.jsx:18`, `queries.js:426`) are **pre-existing drift, out of scope** — don't let them masquerade as this feature's work.
4. **`loadAllRows` embedded-select paging** — the pinned signature is right, but smoke-verify that embedded rows (`call_log`/`customers`/`tenant_config` joins) actually survive `.range()` paging at build; the DEV chunk-repeat warning only catches flat-PK dupes.
5. **Past-due bucket is gross-of-partials by design** — `invoices` has no `amount_paid` column (`paid_at` is binary). That's an *accepted, labeled* limitation (ADJ-6), **not a bug to "fix"** mid-build.

---

## 7. Honest boundary: I audited the PLAN, not the BUILD

The plan↔audit loop converged to "math is correct." It did **not** guarantee the *build* would be correct — and it wasn't fully: T4's buildvsplan still caught **3 Tier-2 findings** against the built code (`5141ed0`). That's the system working as designed, not an audit miss — plan-time review and build-execution review catch different classes of bug ([[feedback_buildvsplan_gate]]). My convergence verdict means "this plan is safe to build from," full stop. The buildvsplan gate is the layer that proves the code matches it. Don't read "audit converged" as "code is clean."

---

## 8. State at this terminal's close

- **Plan:** converged, build-ready as of `3667403` (round-3 response: the REG-A census corrected to 8 copies + off-surface ones scope-deferred). Option 1 held.
- **Build:** executed downstream (migration `41f4305`, core logic `f852139`, two-tab surface `022201e`, card rewire `9b5069b`), buildvsplan ran and its 3 findings fixed (`5141ed0`).
- **Backlog:** 6 adjacent findings filed (ADJ-1..6, `664a2f3`); full text with repo/severity/remedy is in `docs/BACKLOG.md` and was handed to T1 in the synthesis.
- **Audit log:** 3 rows written (one per round) — patterns `status-derivation-arithmetic` / `prose-patch-regressions` / `false-census-claim`.
- **Working tree note:** `docs/BACKLOG.md` had an uncommitted modification not authored by this terminal at handoff time — left untouched ([[feedback_parallel_session_collisions]]); this handoff commit touches only `SCH_HANDOFF_v19.md`.

**Open question still worth Chris settling before/at build** (carried since round 1, never blocking): the **completion signal** (§3.3) — "end date this week" vs DPR-approved/WTC-complete — drives the entire worklist population. T1 resolved it to a hybrid at build start (`e96bd46`); worth a confirm that the hybrid matches how Chris actually triages.

— T2 (audit), out.
