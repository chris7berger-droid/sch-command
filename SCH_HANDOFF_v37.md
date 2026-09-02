# SCH_HANDOFF_v37 — Daily view rebuild finished, gated, and SHIPPED to prod

**Repo:** sch-command · **Branch:** merged to `main` · **Date:** 2026-09-02
**Status:** `feat/daily-view-rebuild` freshened → all 3 gates green → active-status filter restored → **MERGED to main + pushed → deploying to schmybiz.com.** Prod smoke NOT yet done.

> **Numbering note:** v37 follows v36 (`feat/home-redesign`, still its own branch). v34 was claimed by the daily-view branch and rode in via this merge — no collision.

> **Context for this session:** it started as the §8 pre-flight for the Subcon Command Phase 2 merge (a *different* repo — sales-command `feat/schedule-merge-plan`). That safety check — "confirm sch-command main is clean and nothing is trapped on its branches" — is what surfaced `feat/daily-view-rebuild` as real, valuable, unmerged work that a wholesale Phase 2 move would have left behind. So we finished and merged it FIRST.

---

## 1. Session summary

Ran the Subcon-merge §8 pre-flight against sch-command and found one branch with real trapped work: `feat/daily-view-rebuild` (a rebuild of the crew **Daily** view, parked since 2026-08-13). Confirmed it was valuable and NOT superseded — main had never touched `Daily.jsx` since the branch diverged, and prod (schmybiz.com/daily) was still showing the OLD version with doubled job titles and the runaway "Unassigned (55)" dump. Freshened the branch (merged current main in — clean, build green), then ran the full gate set: `/buildvsplan` (GO, 0 blockers), preview smoke (Chris passed a fresh Vercel preview — Unassigned list stays short, sick/call-in crew populate correctly), `/code-review` high (0 ship-blockers), `/security-review` (0 exploitable-today). Code-review surfaced one real divergence from main — the rebuild had dropped main's active-status filter — which Chris ratified restoring. Restored it, merged to main, pushed. Now deploying to production. **UI + read-only queries only — no migration, no writes, no RLS touch.**

## 2. Changes shipped (on `main`)

- `97e0bfe` **Merge origin/main into feat/daily-view-rebuild** — freshened the 8/13 branch up to current Schedule Command (was 52 behind). Clean auto-merge; the only overlap (a 6-line linen block in App.css) resolved by keeping both rules. `Daily.jsx` rebuild intact (462 lines), build green.
- `5b6f6ca` **Daily: restore active-status filter** — re-added main's `['Ongoing','Scheduled','In Progress','On Hold'].includes(j.status)` filter to the job load. The rebuild had dropped it, so a completed/cancelled/parked job dated in-week would have rendered as a false red "0/N Unassigned" alarm. Surfaced by the parallel code-review, ratified by Chris.
- `4112dcf` **Merge feat/daily-view-rebuild into main** (`--no-ff`) — the rebuilt Daily view goes live. Carries the prior-session build commits (`04942ea` rebuild, `980fa86` doubled-title fix, `94b6f75` linen softening, `2450cbf` full-bleed, `094d332` handoff v34).

## 3. Deployed

- **schmybiz.com (Schedule Command prod, Vercel auto-deploy on push to main).** Pushed `main` → `4112dcf`; Vercel building at close. **No migration, no shared-DB touch, no edge fn.** This is the standalone Schedule Command app (still live + used daily by office staff until the eventual Subcon flip), so shipping here is independent of and unrelated to the held Subcon merge.
- **NOTE:** schedulecommand.com is dead (NXDOMAIN). The live domain is **schmybiz.com** (also salescommand.app historically). Handoffs listing schedulecommand.com as prod are stale.

## 4. Gate record (all green)

- **buildvsplan:** GO, 0 Tier-1 / 0 Tier-2 blockers. Data wiring clean — every column the UI reads exists live (200s). jobTitle() doubling fix, linen/full-bleed, week date-overlap filter all confirmed. 2 watch-items handed to smoke (both passed).
- **smoke (Chris, fresh preview):** PASS — Unassigned list short; sick/call-in crew land in the right sections.
- **code-review high:** 0 ship-blockers. Diffed against main and caught the dropped active-status filter (restored, §2) + 6 backlog items (§5). First pass had read only the new file; the background agent's diff-vs-main caught the divergence — owned and corrected in-session.
- **security-review:** 0 exploitable-today. No writes, no new tables/columns/RLS, all DB text auto-escaped as JSX, no user input reaches a query. One standing pre-existing "client gates vs. RLS is the durable boundary" note — out of scope, backlog.

## 5. Decisions / choices made

- **Restore the active-status filter (ratified).** Daily shows only live, schedulable work (Ongoing/Scheduled/In Progress/On Hold), matching the long-used prior behavior — avoids dead-but-dated jobs showing as false red alarms. One-line fix; the alternative (show everything dated in-week) was declined.
- **Finish + merge this branch BEFORE Subcon Phase 2, not during.** Per the "carry items across boundaries" rule: Phase 2 pulls Schedule in wholesale *from sch-command main*, so landing the fix on main first means it rides along automatically instead of being stranded on a side branch.
- **Faithfulness kept where it was intentional:** dateless jobs bypassing the week filter, full-roster "Available", and 2-line title wrap are all data-driven per the rDaily() port and were smoke-confirmed — left as-is, not treated as defects.

## 6. Backlog touched

No formal IDs closed. Filed (from code-review + security-review, none blocking — all cosmetic/hardening on a read-only screen):
- `isLead` uses a substring match on the free-text lead field → can star the wrong crew when one name is a substring of another (Daily.jsx). SHOULD-FIX.
- All sorting removed vs main → cards render in arbitrary PostgREST order, crew unsorted, lead no longer pinned first. SHOULD-FIX (UX regression, renders fine).
- Unrecognized work types render as unstyled pills — only 6 keywords in the tag map. SHOULD-FIX (cosmetic).
- 2X row highlight uses a week-global set → over-reports on cards/days for a crew double-booked any one day (per-cell 2X is correct). HARDENING.
- Status-section lists rebuilt every render instead of `useMemo`; `todayStr` frozen at mount (stale past midnight — also present in main); WorkTags keyed on tag text (dup-key warning if a job lists a type twice). HARDENING/trivial.

## 7. Verification

- **Done:** `vite build` exit 0 (post-freshen and post-filter-fix); buildvsplan GO; Chris smoke-passed a fresh Vercel preview; code-review 0 blockers; security-review 0 exploitable.
- **NOT done:** **prod smoke on schmybiz.com/daily after this deploy finishes.** All eyes-on so far was on the preview, not the deployed main. First next-session action.

## 8. Not touched this session

- **Subcon Command Phase 2** (sales-command `feat/schedule-merge-plan`) — the reason this pre-flight ran, but a separate repo; not started. Held-merge, one-flip-at-end plan unchanged.
- **`feat/home-redesign`** — its own branch/worktree (see v36); untouched here.
- The §6 backlog items — filed, not fixed.

## 9. Next session pointers

- **First action:** once Vercel finishes, smoke **schmybiz.com/daily** (signed in) — confirm short Unassigned list + sick/call-in sections on real prod data, now that the active-status filter is live.
- **Then:** Subcon Command Phase 2 in sales-command (`feat/schedule-merge-plan`) — run its §2 merge-collision pre-flight; the §8 "nothing trapped on sch-command branches" gate is now satisfied for the Daily work.
- The §6 items are backlog, not blockers.

## 10. Files to probably know about next session

- `src/views/Daily.jsx` — the rebuilt crew Daily view (462 lines); active-status filter restored at the job-load filter (~line 103).
- `src/App.css` — the `.dly-v` linen `::before` + `.app-main:has(.dly-v){padding:0}` full-bleed block.

## 11. Git state on close

- **Branch:** `main` @ `4112dcf`, pushed to origin (0/0 before the handoff commit).
- **`feat/daily-view-rebuild`** @ `5b6f6ca` — merged into main, still present local + remote (candidate for deletion, see hygiene).
- **Working tree:** clean apart from this handoff.
- **Other branches:** `feat/home-redesign` (worktree `~/sch-command-home-redesign`), `feat/delete-scheduled-job`, `feat/home-jobs-unified` — see hygiene scan.

## END STATE
**Merged + pushed to main; deploying to schmybiz.com. Prod smoke deferred to next session. Ready for a fresh session — either the prod smoke or Subcon Phase 2.**
