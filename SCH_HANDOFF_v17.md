# SCH_HANDOFF_v17 — BUILD-VS-PLAN terminal · SOW Vertical

**Repo:** sch-command (cross-app: also sales-command, field-command) · branch `feat/sow-vertical`
**Author:** Terminal #4 of 4 — buildvsplan gate
**Date:** 2026-06-16
**Branch HEAD at audit:** sch-command `a24a1c1` (remediation steps 0–5)

The 4-terminal pipeline this round: **#1 plan → #2 audit (/runaudit) → #3 build → #4 buildvsplan (me)**. My job is the gate between "build says done" and "Chris smoke tests" — spec-vs-code **plus** live-schema reality **plus** (new this round) entry-point coverage.

---

## 1. What I gated, in two passes

This vertical went through buildvsplan **twice** because the first build was correct against a stale design.

**Pass 1 — original `sow_vertical.md` build (sales S1–4, sch SCH1–4, field F1–3).**
- Verdict: 37/37 spec checks PASS, 0 code defects. 3 gated deploys flagged (two migrations + F1 PowerSync).
- **What spec-vs-code could not see:** SCH1/2/4 were built on the JobDetail → Planning → Field SOW tab — a surface **production had already retired** for the Option-D `StageJobCard` + in-card modals. The code matched the plan; the plan matched a dead screen. Smoke failed. This is the central lesson (§3).

**Pass 2 — `sow_vertical_schedule_remediation.md` (steps 0–5, this branch).**
- Verdict: all load-bearing Findings A–F + Folds O1–O4 verified; entry-point coverage clean; both crux items PASS.
- One Tier-1 gate remains: the coupled SQL migration `20260616120000` is authored but **not applied** to prod (see §2).

---

## 2. Live-schema state at handoff (the part that lulls — "file exists ≠ deployed")

| Object | Migration | Prod state | Note |
|---|---|---|---|
| `proposal_wtc.dates_tbd` | `20260613120000` (sales) | ✅ applied (probe 200) | clear |
| `job_wtcs.start_date/end_date` nullable | `20260612120000` (sch) | ✅ applied (ledger both cols) | clear |
| `job_base_checklist_passes` WTC-aware redefine | **`20260616120000` (sch)** | 🔴 **Local-only, NOT applied** | the one open Tier-1 |
| RESUME-ALERT trio (`…0503190000/…0512120000/…0512120100`) | — | ✅ reconciled (both cols) | `db push` won't abort on these |

**The one action before smoke:** apply `20260616120000` via the Supabase **dashboard SQL editor** + `supabase migration repair --status applied 20260616120000` (this repo's `db push` is broken — sibling ledger). Ledger max is `20260613120000`, so the timestamp is clear.

**Confirmed in the file (per your note):** the **`jsonb_typeof(w.field_sow) = 'array'` guard landed** in `20260616120000` ahead of `jsonb_array_length` — mandatory, because `job_wtcs.field_sow` is `jsonb NOT NULL` with no array CHECK, so an unguarded `jsonb_array_length` would RAISE on a malformed row and abort the readiness fn (and any assignments/materials recheck that calls it). It is `CREATE OR REPLACE` (not DROP — `assignments_recheck_parents` depends on it), and the crew block is byte-for-byte the `…133000` **assignments** base, not the older `…120000` job_crew one. The SQL is correct; only the apply is pending.

**Blast-radius (so the gate isn't overstated):** the JS `hasFieldSow` predicate is authoritative for the readiness *display* and re-evals every `loadData`, so the tile/badge are correct regardless. The un-applied SQL only matters as the DB auto-demote backstop, which fires on `assignments`/`materials` writes. Because Send-to-Schedule still writes the `jobs.field_sow` flatMap mirror (§6.3), a normally-sent job keeps a non-null parent → the *old* SQL test passes → no wrong-demote on the happy path. The divergence bites only a WTC-only job left with a null parent mirror when a recheck fires. Real, apply it — but unlikely to fail the core smoke.

---

## 3. The insight worth keeping: buildvsplan needs an entry-point-coverage pass

**spec-vs-code and plan-time /runaudit both passed the broken build.** They could not catch it because the failure was a **design-baseline mismatch the plan never named** — the editor was wired correctly to the wrong screen. The class of bug: *a data-model change lands on a surface users no longer reach, while the surface they do reach silently keeps writing the non-canonical field.*

The fix that closes the class (now proven on pass 2):
- **buildvsplan runs an entry-point-coverage pass, not just spec-vs-code.** Enumerate EVERY surface that reads/writes the touched field; confirm each routes to the canonical store; grep-gate that no surface writes the non-canonical field outside an explicit allowlist. On pass 2 this is what produced the clean verdict — Gate 4 (zero inline `field_sow` null-checks outside `hasFieldSow`) and the single-writer allowlist are the teeth.
- **A data-model change requires a design-baseline check in planning** — name the current production design doc and confirm the touched surfaces are live, not retired. `staged_ready_card_design.md` §376 (JobDetail is mgmt-only) was the authority that pass-1 planning skipped.

Both are now codified in the remediation doc §8 as an `/auditcriteria` gate. Recommend they stay there permanently.

---

## 4. Open / parked risks (not defects)

- 🔴 **Apply `20260616120000`** — the one pre-smoke action (§2).
- ⚠️ **Two-tenant PowerSync isolation test — the one genuinely unresolved risk, parked by design.** `job_wtcs` has no `tenant_id`; it reaches a tenant only via `jobs → call_log.tenant_id`. Whether PowerSync's sync role enforces or bypasses that chain is `[DISPUTED]` and **cannot be settled from the repo**. Must be empirically tested (tenant-B `job_wtcs` row must NOT appear on a tenant-A device) **before customer #2 is onboarded**. Currently safe — 1 live tenant (HDSP). Do not skip this gate when multi-tenant ships.
- 🟢 **Jonah confirms crew MAX-vs-SUM** (Field F3) — code uses MAX with a per-task work_type tag so it can flip without re-architecting. Field F1–F3 deferred to Field launch (backlog D1).
- 🟢 **Doc nit:** remediation §7.1 allowlist names *two* legacy `field_sow` writers; step 3 correctly removed JobDetail's, so only **one** survives (`CardSowModal:55`, zero-WTC fallback). Code is right; update the prose.

---

## 5. Smoke verdict handed to Chris

```
🔴 Tier 1: 1 (apply migration 20260616120000)   🟠 Tier 2: 0   🟢 notes: 2
SMOKE: NOT YET — 1 dashboard migration, then GO
Crux (entry-point coverage + card→job_wtcs wiring): PASS — the design-baseline mismatch that failed last smoke is closed.
```

Smoke path to run after the migration applies: author a 2-WTC SOW with per-day dates in Sales → Send to Schedule → confirm 2 `job_wtcs` rows → edit a day's date from the **StageJobCard SOW chip** (not JobDetail) → confirm `job_wtcs` updates + `job_changes` audit row + `proposal_wtc` untouched → confirm "Dates TBD" badge on a TBD WTC.
