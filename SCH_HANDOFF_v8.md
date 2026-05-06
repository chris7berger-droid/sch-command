SCH_HANDOFF_v8 — May 6, 2026
Session: Field SOW materials picker rebuild — Sales Command parity + Custom

===============================================================================
STATE OF PLAY
===============================================================================

Branch: main (merged from refactor/remove-lifecycle-tabs via PR #7)
Last commit on main: 21702bd (merge commit)
Production: deployed to schedulecommand.com via Vercel auto-deploy on main

The v7 branch shipped to prod in one merge: picker IA cleanup, embedded
Schedule view in Job Planning, gate guidance modal, conflict marking,
editable Field SOW builder, AND the materials picker rebuild from this
session. The single open thread blocking the merge (v7 #1) is closed.

===============================================================================
WHAT SHIPPED THIS SESSION (4 commits + merge)
===============================================================================

The brief: Chris rejected the per-day materials editor in v7 (commit
4a9aa5d). His direction this session: "the material fields should be able
to work exactly the same in schedule command as sales command" — same
shared DB, same shape, Schedule's edits are the parent (don't flow back
to Sales). Field needs cure_time / kit_size / mix_time MORE than Sales —
Sales just enters it for the field crew to see.

1. fix(field-sow): source per-day materials from proposal_wtc, not
   procurement tracker (c6ecca3)
   - JobDetail.fetchData now reads proposal_wtc.materials via the
     call_log_id chain and flattens across all WTCs on the job. Schedule
     had never touched proposal_wtc before — fresh source.
   - DayMaterials picker source switched from Schedule's `materials` table
     (procurement tracker — bare names only) to that flattened catalog.
   - Selected card now shows kit_size badge; picker rows show kit_size.

2. fix(field-sow): remove overflow:hidden on day card so picker isn't
   clipped (a50c061)
   - .fsb-day had overflow:hidden which clipped the absolutely-positioned
     dropdown. Dropped it; added border-radius to .fsb-day-header so the
     card's rounded top corners stay crisp.
   - This was the visible regression Chris caught on the preview ("can't
     see the material modal so I can test").

3. fix(field-sow): port DayMaterials picker to match Sales Command exactly
   (95e7996)
   - Rewrote DayMaterials as a port of Sales' FieldSowMaterialPicker
     (~/sales-command/src/pages/WTCCalculator.jsx ~L572).
   - position:fixed dropdown via getBoundingClientRect, drop-up when
     window.innerHeight - rect.bottom < 240, outside-click dismiss on
     mousedown, sticky picker header.
   - Switched FieldSowBuilder handlers from index-keyed to
     wtc_material_id-keyed (add/remove/update). Saved field_sow shape
     unchanged — round-trip with Sales preserved.
   - Material name is static text + kit_size badge on catalog rows
     (Sales-style), not an editable input.
   - 3-col grid layout (qty/mils/coverage, then mix-time/mix-speed/cure-time)
     with `.fsb-mat-spec` + `.fsb-mat-suffix` for inline unit labels.
   - Custom material affordance dropped in this commit (added back in #4).
   - Chris signed off: "Looks perfect."

4. feat(field-sow): re-add Custom material affordance to per-day picker
   (51f00c8)
   - Custom row pinned at bottom of dropdown (italic, command-green, top
     border separator). Picker now opens even when catalog is exhausted
     so Custom is reachable.
   - Synthetic id scheme: `custom_<uuid>` stored in `wtc_material_id`.
     The `custom_` prefix can never collide with numeric proposal_wtc
     ids, so the existing wtc_material_id-keyed handlers work
     transparently. `material_id` stays null.
   - Card render branches by isCustomId(): catalog rows keep static name
     + kit badge; custom rows expose editable name + kit_size inputs.
   - Add button label adapts: "+ Add custom material" when no catalog
     materials, "+ Add material (custom only)" when catalog exhausted,
     otherwise "+ Add material from this job".

5. PR #7 merged to main (21702bd)
   - Bundled the entire refactor/remove-lifecycle-tabs branch — v7 work
     plus this session's 4 commits. 14 files changed, 1225 +/187.
   - Production live on schedulecommand.com.

6. chore: delete dead JobCrewScheduler (3fe9414, direct to main)
   - Removed src/components/JobCrewScheduler.jsx (its import in
     JobDetail.jsx, and ~530 lines of orphan .jcs-* CSS in App.css).
   - 934 lines deleted total. Component was unreferenced since v7's
     embedded Schedule view in Job Planning replaced it.

===============================================================================
ARCHITECTURE NOTES (NEW — record so they don't drift)
===============================================================================

Material identity:
  Catalog rows  → wtc_material_id = String(proposal_wtc.material.id)
                  (numeric — comes from the proposal_wtc.materials jsonb)
  Custom rows   → wtc_material_id = "custom_<uuid>"
                  (never collides with numeric ids; survives reload via
                   handleSave which passes the field through unchanged)
  isCustomId(id) helper in FieldSowBuilder.jsx tests the prefix.

Handler contract (all three keyed by wtc_material_id):
  addMaterialToDay(dayId, source)     // catalog row, source has .id/.product/.kit_size/.coverage
  addCustomMaterialToDay(dayId)       // generates synthetic id, blank fields
  removeMaterialFromDay(dayId, wtcId)
  updateMaterialField(dayId, wtcId, key, val)

Cross-day duplicate filtering:
  Catalog: `selectedIds.has(safeId(m))` filters out catalog materials
  already added to this day. Custom rows have unique synthetic ids so
  they never reduce the available set — same material can be added
  multiple times as separate custom entries (matches Sales catalog
  behavior where duplicates aren't policed by name).

Save shape (unchanged from v7):
  field_sow: [{ day_label, crew_count, hours_planned,
    tasks: [{ description, pct_complete }],
    materials: [{ material_id, wtc_material_id, name, kit_size,
                  qty_planned, mils, coverage_rate,
                  mix_time, mix_speed, cure_time }] }]

Sales round-trip safety:
  Sales reads wtc_material_id as opaque. A custom_… value won't match
  any of its wtcMaterials, so selectedIds.has(...) excludes it from
  re-adding, and the entry simply renders from its persisted
  name/kit_size/specs. No breakage.

Picker positioning:
  position:fixed inline style computed from btnRef.getBoundingClientRect().
  Drop-up condition: window.innerHeight - rect.bottom < 240.
  Container .fsb-mat-add-wrap has the outside-click ref but is no longer
  position:relative-bound (the dropdown floats globally).

===============================================================================
OPEN THREADS (in priority order)
===============================================================================

1. **Pull-back guard in Sales Command.** When a proposal is pulled back
   from approved → editable, and Schedule has already edited field_sow,
   the re-send will overwrite Schedule's work. Need a warn-or-block flow
   in sales-command's pull-back code path. Touches the sales-command repo,
   not this one. (Was v7 thread #2.)

2. **Bin button placement on Pipeline view.** Currently floating right of
   an empty scoreboard slot. Decide: keep, hide, or move next to search.
   (Was v7 thread #3.)

3. **JobDetail tab persistence across job navigation.** When tab state
   carries from a non-parked job (Billing) to a parked job (Management
   group hidden), user lands on a tab with no nav buttons. Clamp tab to
   a planning tab when status === 'Parked'. (Was v7 thread #5.)

4. **Conflict marking on the Schedule grid itself** (not just the modal).
   Modal warns on assign, but the existing crew-row day cells in the grid
   don't visibly flag double-bookings. Worth adding to match. (Was v7
   thread #6.)

5. **Field crew → team_members migration.** Per the field crew filtering
   memory: Ramirez, Little, Loomis, etc. are only in `crew` table, not
   `team_members`. Need team_members rows + Supabase Auth accounts before
   real Field Command deployment. Also unblocks per-crew PowerSync sync
   rules (already written, not yet applied).

===============================================================================
PROCESS NOTES
===============================================================================

- /ultraplan remote session was used for the Sales-match port spec but
  hit an SSH signing service 400 on commit. Workaround: Chris pasted the
  approved plan back, executed locally. Worth knowing the remote session
  can lose work if signing is down — fall back to "dump the diff" or
  "execute locally from the plan."
- Local Plan agent was used for the Custom material design (after the
  signed-off Sales-match port). Plan was terse and accurate; one-shot
  execution worked.
- Branch refactor/remove-lifecycle-tabs was merged via PR #7 (merge
  commit, not squash) so the per-commit history of the picker work
  remains visible on main. Branch left undeleted.

===============================================================================
NEXT SESSION FIRST MOVES
===============================================================================

1. Verify schedulecommand.com prod loads cleanly (look at the Field SOW
   tab on a Parked job — both catalog and custom add).
2. Pick one of the open threads. #1 (Sales pull-back guard) is the
   highest-value if Chris is going to start moving Schedule edits to
   production soon; #2 (Bin button placement) is the cheapest UI call.
3. If field deployment is the next theme: open thread #5 (team_members
   backfill + Auth accounts for the field crew) is the gating work.
