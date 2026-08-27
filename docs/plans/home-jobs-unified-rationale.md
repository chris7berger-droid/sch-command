# Rationale / Decision Trail — Unified Home/Jobs

Companion to `home-jobs-unified.md`. This is the *how and why* — the options considered and rejected on the way to the locked plan, so a future session (or Chris) can review the reasoning, not just the conclusion. Captured 2026-08-27 from the design conversation.

## The triggering question

Chris: after Schedule Command's facelift, the **Jobs screen "sucks"** and Home seems to cover its purpose. Should Jobs be deleted? He explicitly wanted to *avoid overlooking something the Jobs screen does that Home can't* before killing it.

## What the code review found (the constraint)

Reading `Home.jsx` and `Jobs.jsx` surfaced six capabilities that live **only** on Jobs: cross-stage search, reach on-hold jobs, reach finished jobs, browse-all list, the 24h Recovery Bin, and stage management. So a naive "just delete Jobs" would silently drop real function — search, reach-to-finished/on-hold, and the Recovery Bin were the dealbreakers.

**Key unlock:** Chris noted **nobody uses Schedule Command yet.** That removed all migration/retraining risk and reframed the whole thing as a *design-for-buyers* decision, not a change to a live workflow. It also revealed the *real* problem wasn't function — it was **wayfinding**: in demos, prospects scan the left menu for "Jobs" and get confused when it's not an obvious destination.

## The options, in the order they were considered and why each was set aside

1. **Delete Jobs entirely, Home absorbs everything.**
   Rejected — Home has no search and no path to on-hold/finished jobs or the Recovery Bin. Would drop real function, and would remove the "Jobs" menu word buyers look for.

2. **Keep Jobs, but gut it to just search + list; keep Home/Jobs as two menu items.**
   Better, but still two separate screens/routes to maintain, and it left the question of where stage-management lives.

3. **Split by persona: Home = manager cockpit (with stage pipeline), Jobs = estimator's fast read-only list.**
   Right *axis* (who's using it and why), and it stuck: the stage pipeline is a management action estimators shouldn't wade through; the list stays fast precisely because it isn't also a control panel. But as two separate screens it still meant duplicate code and a sync burden. Chris didn't like it as a *two-screen* structure.

4. **[CHOSEN] One screen; left-menu Home/Jobs become scroll anchors into it.**
   Chris's synthesis. Everything lives on one page: Home dashboard at top, Jobs list in the middle, management pipeline at the bottom. "Home" jumps to top, "Jobs" scrolls to the list. Scrolling up from Jobs revealing Home is fine — it's one workspace. This keeps the persona split from option 3 (manager vs estimator sections) **without** the two-screen cost: one route, one data load, zero duplicate code to keep in sync.

## Why the chosen model won (the through-line)

- Solves the **buyer wayfinding** problem directly — "Jobs" is right there in the menu and lands exactly on the list.
- Keeps the **persona separation** that made option 3 right — manager pipeline vs estimator lookup — but as *sections*, not screens.
- **Least to build / maintain** — the deciding factor for Chris. One screen, one load, nothing to sync. ("That seems 10 times easier.")
- Matches the app's stated philosophy: *"3 clicks through simple obvious screens beats 1 click on a complicated screen."* A fast read-only list for estimators, management kept out of their way.

## Decisions locked during the conversation

- **Management section is permission-gated to manager/admin.** Started as Chris's open "question mark," ratified in-conversation: estimators simply don't render that section, which also makes their page shorter/faster — a bonus that reinforced the choice.
- **Estimator Jobs list is read-only on stage** — they *read* status, they can't *change* it. Stage-changing is a management action, moved to the gated section.
- **The clunky parts of today's Jobs get thrown away** — the stage scoreboard, tabs, and date-filter pills. Their *useful* content (cross-stage search, full list, the pipeline, the Recovery Bin) is redistributed to the new sections. This is what removes the "it sucks" feeling.

## What stayed open (carried into the plan's open-questions)

- Management-section **layout**: can't be five long stacked lists or the page never ends → leaning accordion, collapsed-by-stage, expand-on-tap. Needs a sketch.
- The app's **canonical manager/admin permission check** — needs to be located before wiring the gate.
- Where **legacy `/jobs?tab=...` bookmarks** (the `TAB_REDIRECTS` map) land on the unified screen.

## Meta note for whoever picks this up

This was a **design/think-through conversation only** — no code was written, by intent. The output is these two docs. Next step when resumed is `/orient → /decide → /erd-start`; if building, the layout sketch (open question 1) and the permission-gate location (open question 2) are the two things to settle first.
