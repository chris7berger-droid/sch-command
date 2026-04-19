SCH_HANDOFF_v3 — April 18, 2026
Session: Readiness checklist fixes, Job Planning/Management split, cross-app pipeline test

===============================================================================
WHAT WAS DONE
===============================================================================

1. Readiness Checklist — Crew Count Fix (COMMITTED)
   - Checklist now updates live when crew are assigned in the scheduler
   - Added onAssignmentsChange callback from JobCrewScheduler to JobDetail
   - Summary changed from "15 days assigned" to "3 man crew, 5 days"
   - Pulls crew_count from Field SOW to flag mismatches: "(sold as 2 man crew job)"
   - File: src/views/JobDetail.jsx, src/components/JobCrewScheduler.jsx

2. Materials Readiness — Unblocked (COMMITTED)
   - Materials checklist item no longer requires all items to be ordered
   - Ready as long as materials are identified (added to list)
   - Ordering can happen later without blocking job planning
   - File: src/views/JobDetail.jsx

3. Job Planning / Job Management Split (COMMITTED)
   - Replaced "View Detail" button on ALL job cards with two buttons:
     "Job Planning" and "Job Management"
   - Job Planning: shows only Schedule/Materials/Field SOW tabs + readiness checklist
   - Job Management: shows only Overview/Billing/History tabs
   - Uses ?mode=planning or ?mode=management query param on /jobs/:jobId route
   - Applied to both Parked cards and active job cards
   - File: src/views/Jobs.jsx, src/views/JobDetail.jsx

4. Cross-App Pipeline Test — SUCCESS
   - Test job 10044 sent from Schedule Command to Field Command
   - "Send Job Plan to Schedule" updated call_log.stage to 'Scheduled'
   - Job appeared in Field Command simulator via PowerSync sync
   - Field SOW loaded correctly in Field Command TasksTab
   - Crew assignments visible
   - Full Sales -> Schedule -> Field pipeline verified working

===============================================================================
WHAT WAS NOT DONE
===============================================================================

- Did not push to GitHub yet (doing now)
- Did not test DPR submission from Field Command back to Schedule Command
- Did not test time punch data flowing back for billing/payroll

===============================================================================
NEXT SESSION — PRIORITIES
===============================================================================

1. Test DPR (Daily Production Report) flow: Field Command -> Supabase -> Schedule Command
2. Test time punch data visibility in Schedule Command Daily view
3. Build approval queue for DPRs in Schedule Command (manager reviews crew submissions)
4. Build photo gallery view in Schedule Command for Daily Log photos from R2
5. Consider adding the "sold as X man crew job" warning to the Schedule board view

===============================================================================
FILES CHANGED (sch-command repo)
===============================================================================

src/views/JobDetail.jsx           — Live checklist updates, crew count from SOW, mode split
src/views/Jobs.jsx                — Job Planning / Job Management buttons on all cards
src/components/JobCrewScheduler.jsx — onAssignmentsChange callback prop

===============================================================================
BUILD / RUN (quick reference)
===============================================================================

Schedule:       cd ~/sch-command && npm run dev        (localhost:5173)
Sales:          cd ~/sales-command && npm run dev       (localhost:5174)
Field Command:  cd ~/field-command && npx expo run:ios
