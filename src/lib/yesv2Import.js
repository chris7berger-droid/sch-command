// ─────────────────────────────────────────────────────────────────────────────
// YESv2 → Schedule Command import engine (pure logic, no DB, no React)
// ─────────────────────────────────────────────────────────────────────────────
// This is the reusable Customer Onboarding / Import feature's brain, in
// match-to-existing mode (plan docs/plans/schedule_data_migration.md §4/§5).
//
// Everything here is a pure function so it can be unit-tested off a CSV with no
// database and no auth. The DB-facing half (right-pane load, draft persistence,
// additive Apply) lives in importData.js; the UI in views/Import.jsx.
//
// SCOPE (locked): match-to-existing, single-tenant, YESv2 columns HARDCODED.
// NOT here: create-from-CSV mode, generic column-mapping. See §4.
//
// Column meanings were reconstructed from the live "YES Schedule v2" sheet and
// cross-checked against the old one-shot importer (migrate.mjs, reference only).
// Target column names + types are the LIVE DB schema (verified 2026-09-04):
//   jobs.status default 'Parked'; prevailing_wage/partial_billing/billing_paused/
//   no_bill/deleted are TEXT 'Yes'/'No' (NOT boolean); billing_log.invoiced is
//   boolean; crew.archived is boolean; every table stamps tenant_id via the
//   get_user_tenant_id() DEFAULT (so the authed HDSP user's inserts self-tenant —
//   we never send tenant_id, and never send the serial job_id).

// ── The hardcoded YESv2 tab contract (R3-4 header validation) ────────────────
// Exact header sets exported by the "YES Schedule v2" Google Sheet. Header
// validation checks the uploaded file's columns against the tab it claims to be,
// so a malformed / wrong-sheet upload is rejected before it reaches the matcher.
// NOTE the trailing space in 'Notes ' on the Jobs tab — it is real in the export.
export const YESV2_TABS = {
  Jobs: {
    required: [
      'JobID', 'JobNum', 'JobName', 'Amount', 'WorkType', 'CrewNeeded', 'Lead',
      'Vehicle', 'Equipment', 'PowerSource', 'SOW', 'Status', 'StartDate',
      'EndDate', 'Color', 'PrevailingWage', 'PartialBilling', 'PartialBillDate',
      'PartialPercent', 'BilledToDate', 'BillingPaused', 'BillingNotes',
      'DeferredTime', 'DeferredDays', 'NoBillReason', 'NoBill',
    ],
    // 'Notes' carries a trailing space in the live export; accept either form.
    notesKeys: ['Notes ', 'Notes'],
  },
  Assignments: { required: ['JobID', 'CrewName', 'Date'] },
  BillingLog: { required: ['JobID', 'Date', 'Percent', 'CumulativePercent', 'Type', 'Notes', 'Invoiced', 'InvoicedDate'] },
  CrewStatus: { required: ['Name', 'Date', 'Status'] },
}

// Valid jobs.status set (no DB CHECK constraint exists, so a wrong value would
// load SILENTLY — §5/A5). The loader maps Active→Ongoing and flags anything
// outside this set instead of writing it blind.
export const VALID_JOB_STATUS = ['Complete', 'In Progress', 'Ongoing', 'Parked', 'Scheduled']

// ── Header validation (R3-4) ─────────────────────────────────────────────────
// Given the tab name and the actual header row from the upload, report whether
// the columns match the expected contract. `extra` is informational (the sheet
// may carry helper columns); `missing` is fatal — we can't map a tab that's
// missing a required column.
export function validateHeaders(tabName, headers) {
  const spec = YESV2_TABS[tabName]
  if (!spec) return { ok: false, missing: [], extra: [], error: `Unknown tab "${tabName}"` }
  const have = new Set((headers || []).map(h => String(h)))
  // For Jobs, a header is "satisfied by Notes" if either Notes form is present.
  const required = spec.required.slice()
  const missing = required.filter(col => !have.has(col))
  if (spec.notesKeys && !spec.notesKeys.some(k => have.has(k))) missing.push('Notes')
  const known = new Set([...required, ...(spec.notesKeys || [])])
  const extra = [...have].filter(h => !known.has(h))
  return { ok: missing.length === 0, missing, extra, error: null }
}

// ── Value coercion helpers ───────────────────────────────────────────────────

// Text 'Yes'/'No' flag. YESv2 carries 'Yes'/'No' (and occasionally 'true'); the
// target columns are TEXT with a 'No' default — never boolean (§5 gotcha C2).
export function yesNo(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return (s === 'yes' || s === 'true' || s === 'y') ? 'Yes' : 'No'
}

// Money → numeric or null. Strips $ and thousands commas.
export function money(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function intOrNull(v) {
  if (v == null || v === '') return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

export function numOrNull(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

// Wall-clock date → 'YYYY-MM-DD' or null. NEVER goes through Date/toISOString —
// a Postgres `date` is wall-clock; a timezone round-trip shifts it a day
// ([[feedback_date_columns_wall_clock]]). Accepts already-ISO 'YYYY-MM-DD…' and
// US 'M/D/YYYY' (the two shapes Google Sheets exports), else null.
export function wallDate(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const mm = m[1].padStart(2, '0'), dd = m[2].padStart(2, '0')
    return `${m[3]}-${mm}-${dd}`
  }
  return null
}

// Drop the sheet's "n/a" placeholder for asset columns.
function assetOrNull(v) {
  const s = String(v ?? '').trim()
  if (!s || s.toLowerCase() === 'n/a') return null
  return s
}

// ── Row transforms (§5) ──────────────────────────────────────────────────────
// Each returns the target-table insert shape MINUS tenant_id (DB default) and
// MINUS any serial PK. The Jobs transform also returns `_oldJobId` and
// `_statusWarning` as private fields (underscore-prefixed) — the Apply engine
// uses _oldJobId to build the remap and strips both before insert.

export function statusMap(raw) {
  const s = String(raw ?? '').trim()
  if (s === 'Active') return { value: 'Ongoing', warning: null }        // §5 explicit map
  if (s === '') return { value: 'Ongoing', warning: null }              // blank → sensible default
  if (VALID_JOB_STATUS.includes(s)) return { value: s, warning: null }
  // Outside the valid set: keep it, but surface a warning so it can't load blind.
  return { value: s, warning: `Unrecognized status "${s}" (loaded as-is; not in ${VALID_JOB_STATUS.join('/')})` }
}

function notesOf(row) {
  return row['Notes '] ?? row['Notes'] ?? null
}

// One YESv2 Jobs row → a `jobs` insert (call_log_id is set later from the match).
export function transformJob(row) {
  const st = statusMap(row.Status)
  return {
    _oldJobId: String(row.JobID ?? '').trim(),
    _statusWarning: st.warning,
    job_num: (row.JobNum ?? '').toString().trim() || null,
    job_name: (row.JobName ?? '').toString().trim() || null,
    amount: money(row.Amount),
    work_type: (row.WorkType ?? '').toString().trim() || null,
    crew_needed: intOrNull(row.CrewNeeded),
    lead: (row.Lead ?? '').toString().trim() || null,
    vehicle: assetOrNull(row.Vehicle),
    equipment: assetOrNull(row.Equipment),
    power_source: assetOrNull(row.PowerSource),
    sow: (row.SOW ?? '').toString().trim() || null,
    status: st.value,
    start_date: wallDate(row.StartDate),
    end_date: wallDate(row.EndDate),
    color: (row.Color ?? '').toString().trim() || null,
    prevailing_wage: yesNo(row.PrevailingWage),
    partial_billing: yesNo(row.PartialBilling),
    partial_bill_date: wallDate(row.PartialBillDate),
    partial_percent: numOrNull(row.PartialPercent),
    billed_to_date: numOrNull(row.BilledToDate) ?? 0,
    billing_paused: yesNo(row.BillingPaused),
    billing_notes: (row.BillingNotes ?? '').toString().trim() || null,
    notes: (notesOf(row) ?? '').toString().trim() || null,
    deferred_time: (row.DeferredTime ?? '').toString().trim() || null,
    deferred_days: (row.DeferredDays ?? '').toString().trim() || null,
    no_bill: yesNo(row.NoBill),
    no_bill_reason: (row.NoBillReason ?? '').toString().trim() || null,
    deleted: 'No',
    call_log_id: null, // set from the confirmed match at Apply
  }
}

// One YESv2 Assignments row → an `assignments` insert. job_id is REMAPPED at
// Apply (old JobID → freshly-generated jobs.job_id) — here we keep the old id.
export function transformAssignment(row) {
  const oldJobId = String(row.JobID ?? '').trim()
  const crew = (row.CrewName ?? '').toString().trim()
  const date = wallDate(row.Date)
  if (!oldJobId || !crew || !date) return null // skip incomplete rows (matches old importer)
  return { _oldJobId: oldJobId, crew_name: crew, date }
}

// One YESv2 BillingLog row → a `billing_log` insert. job_id REMAPPED at Apply.
export function transformBillingLog(row) {
  const oldJobId = String(row.JobID ?? '').trim()
  if (!oldJobId) return null
  return {
    _oldJobId: oldJobId,
    date: wallDate(row.Date),
    percent: numOrNull(row.Percent) ?? 0,
    cumulative_percent: numOrNull(row.CumulativePercent) ?? 0,
    type: (row.Type ?? '').toString().trim() || null,
    notes: (row.Notes ?? '').toString().trim() || null,
    invoiced: String(row.Invoiced ?? '').trim().toLowerCase() === 'yes',
    invoiced_date: wallDate(row.InvoicedDate),
  }
}

// One YESv2 CrewStatus row → a `crew_status` insert. Keyed by crew_name (no
// job_id), so NO remap. UNIQUE(crew_name, date) → collapse last-wins (§5/B5)
// happens in collapseCrewStatus below.
export function transformCrewStatus(row) {
  const crew = (row.Name ?? '').toString().trim()
  const date = wallDate(row.Date)
  if (!crew || !date) return null
  return { crew_name: crew, date, status: (row.Status ?? '').toString().trim() || null }
}

// Collapse crew_status to one row per (crew_name, date), last-wins — the target
// has UNIQUE(crew_name, date), so duplicate sheet rows would otherwise error.
export function collapseCrewStatus(rows) {
  const byKey = new Map()
  for (const r of rows) if (r) byKey.set(`${r.crew_name}||${r.date}`, r)
  return [...byKey.values()]
}

// Derive the distinct crew roster from Assignments + CrewStatus (§5). crew MUST
// be loaded FIRST — assignments.crew_name and crew_status.crew_name FK crew.name.
// archived is BOOLEAN in the live schema (not the 'Yes'/'No' text used elsewhere).
export function deriveCrew(assignmentRows, crewStatusRows) {
  const names = new Set()
  for (const r of assignmentRows) { const n = (r?.CrewName ?? '').toString().trim(); if (n) names.add(n) }
  for (const r of crewStatusRows) { const n = (r?.Name ?? '').toString().trim(); if (n) names.add(n) }
  return [...names].map(name => ({ name, team: null, phone: null, archived: false }))
}

// ── Smart-assist candidate ranking (§4) ──────────────────────────────────────
// SUGGESTIONS ONLY — never auto-applied. For a left YESv2 job, rank the right-
// side call_log records by, in order: (1) base job-number prefix, (2) customer-
// name similarity, (3) job-name token overlap. Returns candidates sorted best-
// first, each tagged with a 0..1 score and a confidence tier for color-coding.

// Leading numeric run of a job identifier: "6507 CO1" / "6507WTC6" → "6507".
export function baseNumber(s) {
  const m = String(s ?? '').trim().match(/^(\d+)/)
  return m ? m[1] : ''
}

// Normalize a name to lowercase word tokens (drop punctuation, short/noise words).
const NOISE = new Set(['the', 'and', 'of', 'llc', 'inc', 'co', 'company', 'corp', 'construction', 'constr'])
export function tokens(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t && t.length > 1 && !NOISE.has(t))
}

// Jaccard-ish token overlap: shared / min(size) so a short old name that is a
// subset of a long real name still scores high ("Kalb" ⊂ "Kalb - Officers…").
export function tokenOverlap(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return shared / Math.min(A.size, B.size)
}

// Score one call_log candidate against one YESv2 job row (already transformed).
// Weighted: number prefix is the strongest signal, then customer name, then job
// name tokens. Each sub-score is 0..1; weights sum to 1.
export function scoreCandidate(job, cand) {
  const jobBase = baseNumber(job.job_num)
  const candBase = baseNumber(cand.display_job_number) || (cand.job_number != null ? String(cand.job_number) : '')
  const numScore = jobBase && candBase
    ? (jobBase === candBase ? 1 : (candBase.startsWith(jobBase) || jobBase.startsWith(candBase) ? 0.5 : 0))
    : 0
  // The YESv2 JobName frequently carries the customer (old "Kalb"); compare it
  // against BOTH the real customer name and the real job name, take the best.
  const custScore = Math.max(
    tokenOverlap(job.job_name, cand.customer_name),
    tokenOverlap(job.job_name, cand.job_name),
  )
  const nameScore = tokenOverlap(job.job_name, cand.job_name)
  const score = 0.5 * numScore + 0.3 * custScore + 0.2 * nameScore
  return { score, numScore, custScore, nameScore }
}

export function confidenceTier(score) {
  if (score >= 0.6) return 'high'
  if (score >= 0.3) return 'medium'
  return 'low'
}

// Rank all call_log candidates for one job. `limit` caps the returned list
// (default 8) so the UI floats a short candidate list, not all 378.
export function rankCandidates(job, callLogRows, { limit = 8 } = {}) {
  const scored = (callLogRows || []).map(cand => {
    const s = scoreCandidate(job, cand)
    return { candidate: cand, ...s, tier: confidenceTier(s.score) }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.filter(x => x.score > 0).slice(0, limit)
}
