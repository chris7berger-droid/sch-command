# Audit Log — sch-command

Record of audit-terminal reviews. One row per audit pass.

| Date | Subject | Findings | Severity | Outcome | Pattern |
|---|---|---|---|---|---|
| 2026-08-02 | feat/dms1-phase4 @ 6ba68b3 · daily_material_schedule_phase4_build.md (round 3) | 11 (3 reg + 6 new + 2 quar) | 3H/3M/2L | accepted-pending-changes (rev pass 3; REG-A showQty prop; multi-WTC filter+sum; re-audit round 4) | foldin-contradictions / multi-wtc-merge |
| 2026-08-02 | feat/dms1-phase4 @ ad70cec · daily_material_schedule_phase4_build.md (round 2) | 7 groups (+1 adj) | 2H/3M/2L | accepted-pending-changes (rev pass 2; totals re-sourced to proposal_wtc.materials per Chris; re-audit round 3) | totals-source-dead-field / scope-cut |
| 2026-08-02 | feat/dms1-phase4 @ 2b38376 · daily_material_schedule_phase4_build.md (round 1) | 9 (7 groups) | 2H/4M/1L + 2 adj | accepted-pending-changes (revision pass 1; re-audit round 2 on §A+§B) | wrong-baseline-premise |
| 2026-05-28 | f8ddcaf (feat/staged-ready-cards) — jobs readiness migration pre-push | 1 | 1 Crit | accepted; procedure corrected (3-timestamp repair), SQL unchanged | ledger-incomplete-repair |
| 2026-06-11 | feat/sow-vertical @ 963ba50 · docs/plans/sow_vertical.md (round 1) | 6 | 1H/5M | accepted-pending-changes (revision pass 1 = 1a7f2d0; overage cut to Build 2) | writer-coverage |
| 2026-06-12 | feat/sow-vertical @ 9c4e23b · docs/plans/sow_vertical.md (round 2) | 13 (deduped) | 1H/8M/4L | accepted-pending-changes (revision pass 2 = ed03f5f) | stage-map-completeness |
| 2026-06-12 | feat/sow-vertical @ ed03f5f · docs/plans/sow_vertical.md (round 3) | 5 (deduped) | 0H/0M/5L | converged-build-ready (L1/L2 folded as final touch-up; L3/L4→backlog; no round 4) | converged |
| 2026-06-15 | feat/sow-vertical @ acb8e54 · docs/plans/sow_vertical_schedule_remediation.md (round 1) | 12 (deduped) | 5H/4M/3L | accepted-pending-changes (revision pass 1 = 1392dc7) | entry-point-coverage-gap |
| 2026-06-15 | feat/sow-vertical @ 14c12e4 · docs/plans/sow_vertical_schedule_remediation.md (round 2) | 14 (deduped) | 5H/5M/2L | accepted-pending-changes (coverage crux CONVERGED; §6.1 wiring + SQL-fn gaps) | wiring-spec-gaps |
| 2026-06-15 | feat/sow-vertical @ dcf5dd7 · docs/plans/sow_vertical_schedule_remediation.md (round 3, verification) | 4 (deduped) | 1H/0M/3L | CONVERGED — build-ready (H1 jsonb_typeof guard + L1/L2/L3 folded; no round 4) | defensive-sql-guard |
| 2026-07-14 | feat/dms1-phase0-plan @ 5877539 · docs/plans/daily_material_schedule.md (round 1) | 6 (top) + 3 over-cap + 3 adjacent | 4H/2M top-6 | accepted-pending-changes (revision pass 1; C1 grandfather ratified; E1 RLS-half + 1 adjacent REFUTED on re-verify — catalog already role-gated; adjacent → SEC-2/SEC-4) | wrong-premise-baseline |
| 2026-07-14 | feat/dms1-phase0-plan @ 8864e98 · docs/plans/daily_material_schedule.md (round 2) | 7 (2 regressions + 5 new) + 2 over-cap + 1 adjacent | 1H/5M/1L | accepted-pending-changes (revision pass 2; A1 fold-into-Phase-2 + E1 keep-for-class ratified; pass 2 escalated A1 → live mob-stripping bug §0.2b, urgency capped: no office users) | shipped-surface-coverage |
| 2026-07-14 | feat/dms1-phase0-plan @ bea54e4 · docs/plans/daily_material_schedule.md (round 3, verification) | 3 (+3 over-cap) | 0H/3M/0L | accepted-pending-changes (revision pass 3; all round-2 fixes + §0.2b independently confirmed; 9→9→6, first 0-High round — converging) | edge-hardening |
| 2026-07-28 | feat/dms1-phase2-plan @ 0e6137f · docs/plans/daily_material_schedule_buildorder.md (round 1) | 12 (8 top-N + 4 adjacent) | 2H/6M/0L top-N (+4L adjacent) | accepted-pending-changes (revision pass 1; §4B shortage-view CUT to own loop — ratified by Chris; spine hardened for A1/A2/C1/C2/C3/D1/D2/E1) | scope-cut-shortage-math + partial-fix-propagation |
| 2026-07-28 | feat/dms1-phase2-plan @ bc88d3b · daily_material_schedule_buildorder.md + phase2_build.md (round 2, verification) | 2 (1 regression + 1 adjacent) | 1H/0M/1L | accepted-pending-changes (revision pass 2; R1 sch render-input twin + F1 stale manifest line; converging 8→2, BUILD-READY) | partial-fix-propagation (converging) |
