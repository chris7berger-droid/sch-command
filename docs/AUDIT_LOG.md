# Audit Log — sch-command

Record of audit-terminal reviews. One row per audit pass.

| Date | Subject | Findings | Severity | Outcome | Pattern |
|---|---|---|---|---|---|
| 2026-05-28 | f8ddcaf (feat/staged-ready-cards) — jobs readiness migration pre-push | 1 | 1 Crit | accepted; procedure corrected (3-timestamp repair), SQL unchanged | ledger-incomplete-repair |
| 2026-06-11 | feat/sow-vertical @ 963ba50 · docs/plans/sow_vertical.md (round 1) | 6 | 1H/5M | accepted-pending-changes (revision pass 1 = 1a7f2d0; overage cut to Build 2) | writer-coverage |
| 2026-06-12 | feat/sow-vertical @ 9c4e23b · docs/plans/sow_vertical.md (round 2) | 13 (deduped) | 1H/8M/4L | accepted-pending-changes (revision pass 2 = ed03f5f) | stage-map-completeness |
| 2026-06-12 | feat/sow-vertical @ ed03f5f · docs/plans/sow_vertical.md (round 3) | 5 (deduped) | 0H/0M/5L | converged-build-ready (L1/L2 folded as final touch-up; L3/L4→backlog; no round 4) | converged |
| 2026-06-15 | feat/sow-vertical @ acb8e54 · docs/plans/sow_vertical_schedule_remediation.md (round 1) | 12 (deduped) | 5H/4M/3L | accepted-pending-changes (revision pass 1 = 1392dc7) | entry-point-coverage-gap |
| 2026-06-15 | feat/sow-vertical @ 14c12e4 · docs/plans/sow_vertical_schedule_remediation.md (round 2) | 14 (deduped) | 5H/5M/2L | accepted-pending-changes (coverage crux CONVERGED; §6.1 wiring + SQL-fn gaps) | wiring-spec-gaps |
