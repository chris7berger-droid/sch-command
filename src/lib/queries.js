import { supabase } from './supabase'
import { STATUS_OPTIONS_PICKER } from './jobStatus'
import { rollupSowMaterials, coverageStatusFor } from './sowMaterials'

// ── Paginating loader ──────────────────────────────────────────────────────
// PostgREST caps at 1000 rows. This helper pages through with .range().
// orderBy is required — composite-PK tables must specify a stable column.
export async function loadAllRows(tableName, selectStr, {
  orderBy,
  orderAsc = true,
  filterFn,
} = {}) {
  if (!orderBy) throw new Error(`loadAllRows(${tableName}): orderBy is required`)
  const PAGE = 1000
  const all = []
  let chain = supabase.from(tableName).select(selectStr)
  if (filterFn) chain = filterFn(chain)
  chain = chain.order(orderBy, { ascending: orderAsc })

  let firstRowPK = null
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await chain.range(from, from + PAGE - 1)
    if (error) return { data: all, error, partial: true }
    if (import.meta.env.DEV && from === PAGE && data?.length > 0 && firstRowPK != null) {
      if (data[0]?.id === firstRowPK) {
        console.warn(`loadAllRows(${tableName}): chunk 2 repeated chunk 1 — .range() reuse may be broken`)
      }
    }
    if (from === 0 && data?.length > 0) firstRowPK = data[0]?.id ?? null
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: all, error: null, partial: false }
}

// ── Material Memory (Sales-owned materials_catalog) ─────────────────────────
// Read-only reuse in the Field SOW materials picker so Schedule offers the SAME
// saved materials as Sales' WTC builder. RLS scopes rows to the tenant (plus
// system-default rows with tenant_id null). Dedupe by name+kit_size with tenant
// rows winning over system defaults — mirrors sales-command WTCCalculator
// loadCatalog VERBATIM so both apps show one consistent memory. Schedule never
// WRITES this table (custom materials stay SOW-local); saving to the catalog is
// a Sales-side action.
export async function loadMaterialsCatalog() {
  const { data, error } = await loadAllRows(
    'materials_catalog',
    'id, tenant_id, name, kit_size, price, coverage, supplier, mils, mix_time, mix_speed, cure_time, unit, specs_updated_at',
    { orderBy: 'name', filterFn: (q) => q.eq('active', true) }
  )
  if (error) return { data: [], error }
  const byKey = new Map()
  for (const r of data) {
    const key = `${(r.name || '').toLowerCase()}|${(r.kit_size || '').toLowerCase()}`
    const prev = byKey.get(key)
    if (!prev || (prev.tenant_id == null && r.tenant_id != null)) byKey.set(key, r)
  }
  return { data: [...byKey.values()], error: null }
}

// ── Staged/Ready checklist ─────────────────────────────────────────────────
// Base checklist: SOW + date + crew + materials-decided.
// Canonical "does this job have a Field SOW?" test (§4.1). Mirrored VERBATIM by
// SQL job_base_checklist_passes. WTC branch: a job_wtcs row with a non-empty
// ARRAY field_sow — Array.isArray guards the jsonb-NOT-NULL-but-unconstrained
// column (a non-array row ⇒ "no SOW", never a throw). Parent branch: legacy
// merged jobs fall back to the nullable jobs.field_sow. Every JS SOW-present
// reader imports THIS — no inline field_sow null-checks (grep gate §7.1 O3).
export function hasFieldSow(job) {
  return (job?._wtcs?.some(w => Array.isArray(w.field_sow) && w.field_sow.length))
    || job?.field_sow != null
}

// DMS-1 Phase 3 (§5): materials gate now reads job_material_lines (materialRows =
// that table's rows), with FAIL-CLOSED semantics:
//   - No-SOW job → no materials expected → empty is fine (unchanged).
//   - SOW-bearing job with ZERO tracker rows → NOT decided (fail-closed; inverts
//     the old "empty ⇒ auto-pass" so an unseeded SOW job can't slip through).
//   - status NULL (seeded, warehouse hasn't set it) → undecided, blocks (like Not Ordered).
// NOTE (DMS-5): the SQL mirror job_base_checklist_passes() still reads the OLD
// `materials` table and is intentionally NOT updated this phase (deferred, Phase-5
// owned). Safe because every live "ready" read recomputes THIS fn (no consumer
// trusts the stored ready_confirmed_at without recompute — verified 2026-07-30).
// SINGLE SOURCE OF TRUTH for the materials half of the gate — imported by the card
// signals (StageJobCard) too so they can't drift from the gate (T5 finding #1).
export function materialsDecided(job, materialRows) {
  if (!hasFieldSow(job)) return true                 // no SOW → no materials expected
  if (materialRows.length === 0) return false        // fail-closed: SOW but unseeded tracker
  return materialRows.every(m => m.status != null && !['Not Ordered', 'Delayed'].includes(m.status))
}

export function baseChecklistPasses(job, crewRows, materialRows) {
  const hasSOW = hasFieldSow(job)
  const hasDate = (job.scheduled_start || job.start_date) != null
  const hasCrew = crewRows.length >= 1
  return hasSOW && hasDate && hasCrew && materialsDecided(job, materialRows)
}

// Full isReady = base checklist + manual promotion gate.
// crewByCallLog / matsByJobId are pre-indexed Maps for O(1) lookup.
export function isReady(job, crewByCallLog, matsByJobId) {
  const crew = crewByCallLog[job.call_log_id] || []
  const mats = matsByJobId[job.job_id] || []
  return baseChecklistPasses(job, crew, mats) && job.ready_confirmed_at != null
}

// ── Mobilizations (read-only wiring, Master Schedule Phase C) ────────────────
// A mobilization = one trip to site (Mob 1, Mob 2…). Sales authors them on the
// proposal; at send, each SOW day is stamped with a stable `mobilization_seq`.
// We derive the job's mob list from those seq tags on the already-loaded
// job_wtcs.field_sow days (date range + day count come from the ACTUAL tagged
// days) and hydrate the human label + planned dates from proposals.mobilizations
// by seq (mobsBySeq). Read-only — Schedule writes nothing here.
// Fold one field_sow array into the per-seq accumulator. A day counts toward its
// mob whether or not it has a concrete date yet (dates can be TBD post-send).
function collectSeq(sowArray, workTypeName, bySeq) {
  if (!Array.isArray(sowArray)) return
  for (const d of sowArray) {
    const seq = d?.mobilization_seq
    if (seq == null) continue
    const entry = bySeq.get(seq) || { dates: new Set(), count: 0, workTypes: new Set() }
    entry.count += 1
    if (workTypeName) entry.workTypes.add(workTypeName)
    if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.date)) entry.dates.add(d.date.slice(0, 10))
    bySeq.set(seq, entry)
  }
}

export function getJobMobilizations(job, mobsBySeq = {}) {
  const bySeq = new Map() // seq → { dates:Set, count, workTypes:Set }
  const wtcs = Array.isArray(job?._wtcs) ? job._wtcs : []
  for (const w of wtcs) collectSeq(w.field_sow, w.work_type_name, bySeq)
  // Legacy zero-WTC jobs: seq tags live on the flat jobs.field_sow instead.
  if (bySeq.size === 0) collectSeq(job?.field_sow, null, bySeq)

  return [...bySeq.entries()]
    .map(([seq, e]) => {
      const meta = mobsBySeq[seq] || {}
      const sorted = [...e.dates].sort()
      const hasConcrete = sorted.length > 0
      return {
        seq,
        label: meta.label || `Mob ${seq}`,
        dayCount: e.count,                 // # of SOW days tagged to this mob (dated or TBD)
        workTypes: [...e.workTypes],
        // Prefer the actual tagged-day span; else the proposal's planned dates.
        start_date: hasConcrete ? sorted[0] : (meta.start_date || null),
        end_date: hasConcrete ? sorted[sorted.length - 1] : (meta.end_date || null),
        // True when the range comes from the proposal plan, not yet-scheduled days.
        datesPlanned: !hasConcrete && (meta.start_date != null || meta.end_date != null),
        // Phase F: go-back flag from job_mobilizations (proposal fallback → false).
        is_go_back: !!meta.is_go_back,
        days: sorted,
      }
    })
    .sort((a, b) => a.seq - b.seq)
}

// Phase F (F3) — per-mobilization cost rollup, derived on read (D6). For each
// mobilization seq, sum the cost of every field-SOW day tagged to it, across all
// the job's WTCs (whole tagged day counts toward its mob — audit O6). Returns
// { [seq]: { materialCost, laborCost, total, dayCount, unpriced, needsRate } }.
//
//  • Material $ = Σ qty_planned × unit price. Price source (D6, audit A1): a
//    stamped price_per_unit wins (original sold lines); else materials_catalog.price
//    joined on catalog_id; else fall back to (name, kit_size) ONLY when catalog_id
//    is null. Off-catalog (no id, no name match) → $0 with `unpriced` flagged —
//    never a silent zero. qty_planned = number of priced units (kits/boxes), D6.
//  • Labor $ = Σ hours_planned × rate (crew_count is NOT a multiplier — hours are
//    already total man-hours, D6). Rate = the WTC's stamped bid_breakdown.burden_rate
//    (PW-correct: calc stamps pw_rate on PW jobs). Unstamped WTC → tenant
//    default_burden_rate ONLY on a non-PW job; a PW job with no stamped rate flags
//    `needsRate` rather than undercosting with the standard default (D6/B1).
export function computeMobCosts(job, catalog = []) {
  const byId = new Map()
  const byNameKit = new Map()
  for (const c of (catalog || [])) {
    if (c?.id != null) byId.set(String(c.id), c)
    const key = `${(c?.name || '').toLowerCase()}|${(c?.kit_size || '').toLowerCase()}`
    if (!byNameKit.has(key)) byNameKit.set(key, c)
  }
  // Unit price for a day-material line. Returns null when nothing prices it.
  const priceOf = (m) => {
    const stamped = parseFloat(m?.price_per_unit)
    if (stamped > 0) return stamped
    if (m?.catalog_id != null) {
      const hit = byId.get(String(m.catalog_id))
      if (hit && hit.price != null) return parseFloat(hit.price) || 0
    } else {
      const key = `${(m?.name || m?.product || '').toLowerCase()}|${(m?.kit_size || m?.kit || '').toLowerCase()}`
      const hit = byNameKit.get(key)
      if (hit && hit.price != null) return parseFloat(hit.price) || 0
    }
    return null // off-catalog / unpriced
  }

  const isPW = job?.prevailing_wage === 'Yes' || job?.prevailing_wage === true
  const tenantRate = parseFloat(job?.default_burden_rate)
  const out = {}
  const ensure = seq => (out[seq] || (out[seq] = { materialCost: 0, laborCost: 0, total: 0, dayCount: 0, unpriced: false, needsRate: false }))

  const wtcs = Array.isArray(job?._wtcs) && job._wtcs.length ? job._wtcs : null
  // Each unit: { days, rate|null }. Legacy zero-WTC jobs have no bid_breakdown, so
  // their rate resolves off the job (default / PW rule) exactly like an unstamped WTC.
  const units = wtcs
    ? wtcs.map(w => ({ days: Array.isArray(w.field_sow) ? w.field_sow : [], bid: w.bid_breakdown }))
    : [{ days: Array.isArray(job?.field_sow) ? job.field_sow : [], bid: null }]

  for (const u of units) {
    const stampedRate = parseFloat(u.bid?.burden_rate)
    let rate = null // null ⇒ unknown (needsRate)
    if (stampedRate > 0) rate = stampedRate
    else if (!isPW && tenantRate > 0) rate = tenantRate
    // else: PW-unstamped, or no default → rate stays null (needsRate)

    for (const d of u.days) {
      const seq = d?.mobilization_seq
      if (seq == null) continue
      const e = ensure(seq)
      e.dayCount += 1
      // Labor
      const hours = parseFloat(d.hours_planned) || 0
      if (hours > 0) {
        if (rate != null) e.laborCost += hours * rate
        else e.needsRate = true
      }
      // Materials
      for (const m of (d.materials || [])) {
        const qty = parseFloat(m?.qty_planned) || 0
        if (qty <= 0) continue
        const price = priceOf(m)
        if (price == null) e.unpriced = true
        else e.materialCost += qty * price
      }
    }
  }
  for (const seq of Object.keys(out)) out[seq].total = out[seq].materialCost + out[seq].laborCost
  return out
}

// Batched read of proposal-authored mobilization metadata (label + planned
// dates) keyed by call_log_id → { [seq]: {label, start_date, end_date} }.
// proposals is Sales-owned/canonical; read-only. Live (non-archive) proposals
// win when a call_log has both an archive and a live proposal.
export async function loadMobilizationsByCallLog(callLogIds) {
  const out = {}
  const ids = [...new Set((callLogIds || []).filter(Boolean))]
  if (!ids.length) return out
  const { data, error } = await supabase
    .from('proposals')
    .select('call_log_id, mobilizations, is_archive_proposal')
    .in('call_log_id', ids)
    .not('mobilizations', 'is', null)
  if (error) { console.warn('[mobs] could not load proposal mobilizations:', error.message); return out }
  // Non-archive first so it wins the `!(seq in map)` first-writer check below.
  const rows = [...(data || [])].sort((a, b) => Number(!!a.is_archive_proposal) - Number(!!b.is_archive_proposal))
  for (const row of rows) {
    const clId = row.call_log_id
    if (clId == null || !Array.isArray(row.mobilizations)) continue
    const map = out[clId] || (out[clId] = {})
    for (const m of row.mobilizations) {
      if (m && m.seq != null && !(m.seq in map)) {
        map[m.seq] = { label: m.label || null, start_date: m.start_date || null, end_date: m.end_date || null }
      }
    }
  }
  return out
}

// Phase F (D1) — post-send source of truth. Batched read of the LIVE job's
// mobilizations from job_mobilizations, keyed by job_id → { [seq]: {label,
// start_date, end_date, is_go_back} }.
//
// Keyed by JOB_ID, NOT call_log_id (round-1 B1 / audit E1): a call_log can carry
// multiple jobs (archive + live — the dedup in loadMobilizationsByCallLog proves
// it happens), so a call_log-keyed read would hydrate the wrong job's mobs. This
// is why loadMobilizationsByCallLog is NOT reused directly for the live read.
//
// PERMANENT fallback (audit E2, not gate-removable): the send-time seed is
// non-fatal (F1), so a live job can legitimately have 0 job_mobilizations rows
// while its days are tagged. Any such job falls back — WHOLESALE per job (never a
// per-seq merge) — to the proposal-authored mobs by its call_log_id. A correct
// standing fallback is fine to keep indefinitely.
//
// Takes the loaded job objects (needs job_id + call_log_id for the fallback).
export async function loadMobilizationsByJobId(jobs) {
  const out = {}
  const list = (jobs || []).filter(j => j && j.job_id != null)
  if (!list.length) return out
  const jobIds = [...new Set(list.map(j => j.job_id))]

  const { data, error } = await supabase
    .from('job_mobilizations')
    .select('job_id, seq, label, start_date, end_date, is_go_back')
    .in('job_id', jobIds)
  if (error) {
    console.warn('[mobs] could not load job_mobilizations:', error.message)
  } else {
    for (const row of (data || [])) {
      if (row.job_id == null || row.seq == null) continue
      const map = out[row.job_id] || (out[row.job_id] = {})
      map[row.seq] = {
        label: row.label || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        is_go_back: !!row.is_go_back,
      }
    }
  }

  // Wholesale per-job fallback for jobs with 0 job_mobilizations rows.
  const needFallback = list.filter(j => !out[j.job_id] || Object.keys(out[j.job_id]).length === 0)
  const fbCallLogIds = [...new Set(needFallback.map(j => j.call_log_id).filter(Boolean))]
  if (fbCallLogIds.length > 0) {
    const byCallLog = await loadMobilizationsByCallLog(fbCallLogIds)
    for (const j of needFallback) {
      const meta = j.call_log_id != null ? byCallLog[j.call_log_id] : null
      if (meta && Object.keys(meta).length > 0) out[j.job_id] = meta
    }
  }
  return out
}

// ── Call_log fields pulled via join ─────────────────────────────────────────
const CALL_LOG_SELECT = `
  call_log (
    id,
    job_name,
    display_job_number,
    customer_name,
    sales_name,
    stage,
    jobsite_address,
    jobsite_city,
    jobsite_state,
    jobsite_zip,
    prevailing_wage,
    customer_id,
    is_change_order,
    co_number,
    show_cents,
    customers:customer_id (
      requires_pay_app
    ),
    tenant_config:tenant_id (
      default_burden_rate
    )
  )
`.replace(/\s+/g, ' ').trim()

// ── Normalize a joined row into a flat shape ────────────────────────────────
// Shared fields prefer call_log when available, fall back to jobs (legacy rows)
function normalizeJob(row) {
  const cl = row.call_log || {}
  const wtcs = Array.isArray(row.job_wtcs) ? row.job_wtcs : []
  return {
    ...row,
    // shared fields — call_log is source of truth
    job_name:           cl.job_name            || row.job_name,
    job_num:            cl.display_job_number  || row.job_num,
    customer_name:      cl.customer_name       || null,
    sales_name:         cl.sales_name          || null,
    jobsite_address:    cl.jobsite_address     || null,
    jobsite_city:       cl.jobsite_city        || null,
    jobsite_state:      cl.jobsite_state       || null,
    jobsite_zip:        cl.jobsite_zip         || null,
    prevailing_wage:    cl.prevailing_wage != null
                          ? (cl.prevailing_wage ? 'Yes' : 'No')
                          : row.prevailing_wage,
    stage:              cl.stage               || null,
    customer_id:        cl.customer_id         || null,
    is_change_order:    cl.is_change_order     || false,
    co_number:          cl.co_number           || null,
    show_cents:         cl.show_cents          || false,
    // Phase F (F3) — tenant fallback labor rate for the go-back cost rollup, used
    // ONLY when a WTC has no stamped bid_breakdown.burden_rate AND the job is not
    // prevailing-wage (a PW job with no stamped rate surfaces "needs rate" instead
    // of ever applying the standard default — D6/B1).
    default_burden_rate: cl.tenant_config?.default_burden_rate ?? null,
    // deposit tag — derived from the job's DEPOSIT INVOICES (Sales marks each one),
    // not from a job-level flag. _deposit is attached by loadJobs, not here.
    _deposit: null,
    // pay-app flag on the JOB row (via call_log → customers embed, C1). Present
    // regardless of invoice state, so un-invoiced pay-app jobs still surface in
    // the Pay Apps card. Distinct from the invoice-derived _requires_pay_app on
    // billing-surface invoices (loadBillingSurfaceData) — see billingForecast B1.
    requires_pay_app:   cl.customers?.requires_pay_app ?? false,
    // keep raw call_log for detail views
    _call_log: cl,
    // per-WTC attributes (empty for legacy rows; readers fall back to
    // jobs.field_sow / jobs.material_status when this is empty)
    _wtcs: wtcs,
  }
}

// ── Deposit indicator ───────────────────────────────────────────────────────
// Pure derivation: a job's ACTIVE deposit invoices → the scheduling-readiness
// indicator. Rewritten 2026-07-31: a job bills a SEPARATE material deposit per
// WTC, so this reads a LIST (invoices.is_deposit) instead of the retired
// one-per-job call_log.deposit_invoice_id pointer. There is no job-level
// "deposit required" flag any more — the invoices tell the whole story.
//
// Returns null when the job has no deposit invoices at all (tag hidden).
//   required = at least one deposit invoice is still unsent
//   sent     = all sent, at least one unpaid → days since the OLDEST send,
//              plus the earliest unpaid due date (the one that bites first)
//   paid     = every deposit invoice is paid
//
// amount is the figure to SHOW, and it answers the question the tag is asking:
// while anything is unpaid that's what's STILL OWED, not the job's deposit size —
// a job with $4k in and $6k out should read $6k, not $10k. Once everything is
// paid it flips to the full total collected. amountTotal always carries the sum,
// for anywhere that wants the deposit's overall size. Both net of discount, and
// both derived from the invoices — no hand-typed figure to keep in sync.
export function depositState(job, depositsByJob) {
  const list = depositsByJob.get(job?.call_log_id) || []
  if (!list.length) return null

  const net = (i) => (Number(i.amount) || 0) - (Number(i.discount) || 0)
  const amountTotal = list.reduce((sum, i) => sum + net(i), 0)
  const unpaid = list.filter((i) => !i.paid_at)
  if (!unpaid.length) {
    return { status: 'paid', amount: amountTotal, amountTotal, daysSince: null, dueDate: null }
  }
  const amount = unpaid.reduce((sum, i) => sum + net(i), 0)

  // Earliest due date among the ones still owed — that's the date that matters.
  const dueDate = unpaid
    .map((i) => i.due_date)
    .filter(Boolean)
    .sort()[0] || null

  const unsent = unpaid.filter((i) => !i.sent_at)
  if (unsent.length) return { status: 'required', amount, amountTotal, daysSince: null, dueDate }

  // All sent, some unpaid → age off the oldest outstanding send.
  const oldestSent = unpaid.map((i) => i.sent_at).filter(Boolean).sort()[0]
  const daysSince = oldestSent
    ? Math.floor((Date.now() - new Date(oldestSent).getTime()) / 86400000)
    : null
  return { status: 'sent', amount, amountTotal, daysSince, dueDate }
}

// Best-effort: enrich jobs in place with j._deposit. Reads the ACTIVE deposit
// invoices for the loaded jobs (one query; deposits are a small slice of the
// invoice table and the partial index invoices_is_deposit_call_log_idx covers
// it). On any error, leaves _deposit null — never blocks the job list.
// invoices is canonical Sales-owned; read-only.
async function attachDepositState(jobs) {
  const callLogIds = [...new Set(jobs.map((j) => j.call_log_id).filter(Boolean))]
  const byJob = new Map()
  if (callLogIds.length) {
    const { data, error } = await supabase
      .from('invoices')
      .select('id, call_log_id, amount, discount, sent_at, due_date, paid_at')
      .eq('is_deposit', true)
      .in('call_log_id', callLogIds)
      .is('voided_at', null)
      .is('deleted_at', null)
    // Best-effort, but NOT silent: "query failed" and "this job has no deposits"
    // both render as no tag, so a swallowed error is indistinguishable from a
    // correct empty result (e.g. deployed before the is_deposit migration lands).
    if (error) console.warn('[deposit] could not load deposit invoices:', error.message)
    for (const inv of data || []) {
      const list = byJob.get(inv.call_log_id)
      if (list) list.push(inv)
      else byJob.set(inv.call_log_id, [inv])
    }
  }
  for (const j of jobs) j._deposit = depositState(j, byJob)
}

// ── Load jobs with call_log join ────────────────────────────────────────────
// Replaces: supabase.from('jobs').select('*')
//
// withWTCs: when true, also left-joins job_wtcs and attaches j._wtcs.
// Legacy rows have zero job_wtcs children — _wtcs comes back as [].
export async function loadJobs({ includeDeleted = false, withWTCs = false } = {}) {
  const sel = withWTCs
    ? `*, ${CALL_LOG_SELECT}, job_wtcs(*)`
    : `*, ${CALL_LOG_SELECT}`

  let query = supabase
    .from('jobs')
    .select(sel)

  if (!includeDeleted) {
    query = query.or('deleted.is.null,deleted.eq.No')
  }

  const { data, error } = await query
  if (error) return { data: null, error }
  const jobs = (data || []).map(normalizeJob)
  await attachDepositState(jobs)
  return { data: jobs, error: null }
}

// ── Load a single job by job_id ─────────────────────────────────────────────
export async function loadJob(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select(`*, ${CALL_LOG_SELECT}`)
    .eq('job_id', jobId)
    .single()

  if (error) return { data: null, error }
  return { data: normalizeJob(data), error: null }
}

// ── Load a single job with its job_wtcs children ────────────────────────────
export async function loadJobWithWTCs(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select(`*, ${CALL_LOG_SELECT}, job_wtcs(*)`)
    .eq('job_id', jobId)
    .single()

  if (error) return { data: null, error }
  return { data: normalizeJob(data), error: null }
}

// ── Update a job field with audit logging ───────────────────────────────────
export async function updateJobField(jobId, field, newValue, changedBy, source = 'schedule_command') {
  // read current value
  const { data: current } = await supabase
    .from('jobs')
    .select(`${field}, call_log_id`)
    .eq('job_id', jobId)
    .single()

  const oldValue = current ? String(current[field] ?? '') : ''
  const newStr = String(newValue ?? '')

  // write update
  const { error } = await supabase
    .from('jobs')
    .update({ [field]: newValue })
    .eq('job_id', jobId)

  if (error) return { error }

  // log if changed
  if (newStr !== oldValue) {
    await supabase.from('job_changes').insert({
      job_id: jobId,
      call_log_id: current?.call_log_id || null,
      field,
      old_value: oldValue || null,
      new_value: newStr || null,
      changed_by: changedBy,
      source,
    })
  }

  return { error: null }
}

// ── Update multiple job fields at once with audit logging ───────────────────
export async function updateJobFields(jobId, updates, changedBy, source = 'schedule_command', { skipAuditFields = [] } = {}) {
  const fields = Object.keys(updates)
  const selectFields = [...fields, 'call_log_id'].join(', ')

  // read current values
  const { data: current } = await supabase
    .from('jobs')
    .select(selectFields)
    .eq('job_id', jobId)
    .single()

  // write update
  const { error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('job_id', jobId)

  if (error) return { error }

  // log each changed field (skip fields handled by DB trigger to avoid duplicates)
  const logs = []
  for (const field of fields) {
    if (skipAuditFields.includes(field)) continue
    const oldValue = String(current?.[field] ?? '')
    const newValue = String(updates[field] ?? '')
    if (newValue !== oldValue) {
      logs.push({
        job_id: jobId,
        call_log_id: current?.call_log_id || null,
        field,
        old_value: oldValue || null,
        new_value: newValue || null,
        changed_by: changedBy,
        source,
      })
    }
  }
  if (logs.length > 0) {
    await supabase.from('job_changes').insert(logs)
  }

  return { error: null }
}

// ── Stage-sync chokepoint (SCH3) ────────────────────────────────────────────
// Every jobs.status write MUST go through updateJobStatus() so the paired
// call_log.stage (which drives Field's PowerSync visibility filter) can never
// drift out of sync. Stage resolution lives INSIDE the helper, so no caller can
// forget it; the map is fully enumerated and the helper THROWS (fail-closed) on
// any unmapped status rather than silently skipping the stage write.
//
// On Hold → 'In Progress' (Option 1, LOCKED 2026-06-12): 'In Progress' is
// already in the Field call_log.stage filter, so a held job stays synced to the
// crew with NO powersync-sync-rules.yaml edit. See plan §3.6 + §SCH3.
const STATUS_TO_STAGE = {
  'Scheduled':   'Scheduled',
  'In Progress': 'In Progress',
  'On Hold':     'In Progress',
  'Ongoing':     'In Progress',
  'Complete':    'Complete',
}

// Startup invariant: every status the user can assign from the dropdown must
// have a stage mapping, else updateJobStatus would throw the moment it's picked.
// This converts "someone added a dropdown option without a map entry" into a
// loud, pre-ship failure instead of a silently-stale stage that drops the job
// from the crew.
for (const pickerStatus of STATUS_OPTIONS_PICKER) {
  if (STATUS_TO_STAGE[pickerStatus] === undefined) {
    throw new Error(
      `STATUS_TO_STAGE is missing an entry for picker status "${pickerStatus}" — ` +
      `every STATUS_OPTIONS_PICKER value must map to a call_log stage (SCH3 fail-closed invariant).`
    )
  }
}

// Write jobs.status (plus any paired fields) and unconditionally sync the
// paired call_log.stage. Routes the jobs write through updateJobFields so audit
// logging + the on_hold_resume source/skipAuditFields behavior are preserved.
//   opts.extraFields     — extra jobs columns to write alongside status
//                          (e.g. { ready_confirmed_at: null } on resume)
//   opts.skipAuditFields — fields to skip in the job_changes audit log
export async function updateJobStatus(jobId, newStatus, changedBy, source = 'schedule_command', { extraFields = {}, skipAuditFields = [] } = {}) {
  // Fail-closed: resolve the stage BEFORE any write. An unmapped status throws
  // here, so neither jobs.status nor call_log.stage is touched.
  const newStage = STATUS_TO_STAGE[newStatus]
  if (newStage === undefined) {
    throw new Error(
      `updateJobStatus: unmapped status "${newStatus}" — add it to STATUS_TO_STAGE ` +
      `(fail-closed: refusing to write a status with no paired call_log stage).`
    )
  }

  // 1) write jobs.status (+ paired fields) through the audit-logged path
  const { error } = await updateJobFields(jobId, { status: newStatus, ...extraFields }, changedBy, source, { skipAuditFields })
  if (error) return { error }

  // 2) unconditionally sync the paired call_log.stage when the job has a call_log
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('call_log_id')
    .eq('job_id', jobId)
    .single()
  if (jobRow?.call_log_id) {
    const { error: stageErr } = await updateCallLogStage(jobRow.call_log_id, newStage, changedBy, source)
    if (stageErr) return { error: stageErr }
  }

  return { error: null }
}

// ── PRT readers (Field Command writes via PowerSync) ───────────────────────
// daily_production_reports.job_id is FK to call_log.id (NOT jobs.job_id).
// Always pass job.call_log_id, not job.job_id.

export async function loadPRTsForCallLogIds(callLogIds) {
  if (!callLogIds || callLogIds.length === 0) {
    return { data: new Map(), error: null, partial: false }
  }
  const CHUNK = 100
  const chunks = []
  for (let i = 0; i < callLogIds.length; i += CHUNK) {
    chunks.push(callLogIds.slice(i, i + CHUNK))
  }
  const settled = await Promise.allSettled(chunks.map(ids =>
    supabase
      .from('daily_production_reports')
      .select('id, job_id, wtc_id, report_date, submitted_by, tasks, materials_used, hours_regular, hours_ot, photos, notes, status, approved_by, approved_at, created_at, tenant_id, team_members:submitted_by(id, name)')
      .in('job_id', ids)
      .order('report_date', { ascending: false })
  ))
  const byCallLogId = new Map()
  let firstError = null
  let rejected = 0
  for (const r of settled) {
    if (r.status === 'fulfilled' && !r.value.error) {
      for (const row of (r.value.data || [])) {
        const arr = byCallLogId.get(row.job_id) || []
        arr.push(row)
        byCallLogId.set(row.job_id, arr)
      }
    } else {
      rejected++
      if (!firstError) firstError = r.status === 'fulfilled' ? r.value.error : r.reason
    }
  }
  for (const [, arr] of byCallLogId) {
    arr.sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))
  }
  return { data: byCallLogId, error: firstError, partial: rejected > 0 }
}

export async function loadPRTsForJob(callLogId) {
  if (!callLogId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('daily_production_reports')
    .select('id, job_id, wtc_id, report_date, submitted_by, tasks, materials_used, hours_regular, hours_ot, photos, notes, status, approved_by, approved_at, created_at, tenant_id, team_members:submitted_by(id, name)')
    .eq('job_id', callLogId)
    .order('report_date', { ascending: false })
  if (error) return { data: null, error }
  return { data: data || [], error: null }
}

export async function loadPRT(prtId) {
  const { data, error } = await supabase
    .from('daily_production_reports')
    .select('*, team_members:submitted_by(id, name)')
    .eq('id', prtId)
    .single()
  if (error) return { data: null, error }
  return { data, error: null }
}

// daily_log_entries.job_id is FK to call_log.id (NOT jobs.job_id).
// employee_id is text, references team_members.id (uuid).
export async function loadDailyLogsForJob(callLogId) {
  if (!callLogId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('daily_log_entries')
    .select('id, job_id, employee_id, entry_type, photos, notes, created_at')
    .eq('job_id', callLogId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error }
  return { data: data || [], error: null }
}

export async function loadRecentPRTs(days = 14) {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('daily_production_reports')
    .select('id, job_id, report_date, submitted_by, tasks, hours_regular, hours_ot, photos, status, team_members:submitted_by(id, name), call_log:job_id(id, display_job_number, job_name)')
    .gte('report_date', sinceStr)
    .order('report_date', { ascending: false })
    .limit(500)
  if (error) return { data: null, error }
  return { data: data || [], error: null }
}

let _teamMemberMapCache = null
export async function loadTeamMemberMap({ refresh = false } = {}) {
  if (_teamMemberMapCache && !refresh) return { data: _teamMemberMapCache, error: null }
  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, role, email')
  if (error) return { data: null, error }
  const map = {}
  for (const m of (data || [])) map[m.id] = m
  _teamMemberMapCache = map
  return { data: map, error: null }
}

// ── Multi-week alert (M6 tightening) ────────────────────────────────────────
// Returns the count of weeks AFTER the job's start week that the job spans
// where this specific job has zero crew assignments. 0 = no alert.
// See plan §6.1 for the criterion and §6.5 for the perf envelope.

function _fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function _getMonday(d) {
  const dt = d instanceof Date ? new Date(d) : new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}

export function getJobMultiWeekAlert(job, assignments, today) {
  const start = job?.scheduled_start || job?.start_date
  const end = job?.scheduled_end || job?.end_date
  if (!start || !end) return 0

  const startD = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  const startMonday = _getMonday(startD)
  const endMonday = _getMonday(endD)
  if (startMonday.getTime() === endMonday.getTime()) return 0

  let alerts = 0
  const cursor = new Date(startMonday)
  cursor.setDate(cursor.getDate() + 7)  // skip start week

  while (cursor.getTime() <= endMonday.getTime()) {
    const daysInWeek = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(cursor); d.setDate(d.getDate() + i)
      const ds = _fmtD(d)
      if (ds >= start && ds <= end) daysInWeek.push(ds)
    }
    const hasAsgn = (assignments || []).some(a =>
      a.job_id === job.job_id && daysInWeek.includes(a.date)
    )
    if (!hasAsgn) alerts++
    cursor.setDate(cursor.getDate() + 7)
  }
  return alerts
}

// ── Update call_log stage with audit logging ────────────────────────────────
export async function updateCallLogStage(callLogId, newStage, changedBy, source = 'schedule_command') {
  // read current stage
  const { data: current } = await supabase
    .from('call_log')
    .select('stage')
    .eq('id', callLogId)
    .single()

  const oldStage = current?.stage || ''

  // write update
  const { error } = await supabase
    .from('call_log')
    .update({ stage: newStage })
    .eq('id', callLogId)

  if (error) return { error }

  // log if changed — use call_log_id but no job_id (this is a call_log update)
  if (newStage !== oldStage) {
    await supabase.from('job_changes').insert({
      job_id: null,
      call_log_id: callLogId,
      field: 'stage',
      old_value: oldStage || null,
      new_value: newStage,
      changed_by: changedBy,
      source,
    })
  }

  return { error: null }
}

// ── Schedule calendar-layer write on job_wtcs (SCH1) ────────────────────────
// Schedule owns the calendar on job_wtcs: per-day dates live in
// field_sow[*].date and the WTC span lives in start_date/end_date (derived here
// from the per-day dates). All Schedule field_sow / per-day-date writes route
// through this helper so they are audit-logged like every other job write — do
// NOT write job_wtcs via a raw supabase.from('job_wtcs').update(). Scope is
// frozen at the proposal; this only moves the calendar, never financials.
//
// NOTE: field_sow is an ARRAY of day objects, so old/new values are serialized
// with JSON.stringify — NOT String() (which the scalar helpers use). String()
// on an array yields structure-losing garbage in the audit row. See plan §SCH1.
export async function updateJobWtcFieldSow(jobWtcId, nextFieldSow, changedBy, source = 'schedule_command') {
  // read current field_sow + parent job/call_log for the audit row
  const { data: current, error: readErr } = await supabase
    .from('job_wtcs')
    .select('field_sow, job_id, jobs(call_log_id)')
    .eq('id', jobWtcId)
    .single()
  if (readErr) return { error: readErr }

  // Derive the WTC calendar span from the per-day dates (null when none dated —
  // the §6.6 migration made start_date/end_date nullable for exactly this).
  const dates = (nextFieldSow || []).map(d => d && d.date).filter(Boolean).sort()
  const startDate = dates[0] || null
  const endDate = dates.length ? dates[dates.length - 1] : null

  // write field_sow + derived span
  const { error } = await supabase
    .from('job_wtcs')
    .update({ field_sow: nextFieldSow, start_date: startDate, end_date: endDate })
    .eq('id', jobWtcId)
  if (error) return { error }

  // audit-log — JSON.stringify (not String()); keyed on the parent job so the
  // history view still attributes the change to the job.
  const oldStr = JSON.stringify(current?.field_sow ?? [])
  const newStr = JSON.stringify(nextFieldSow ?? [])
  if (oldStr !== newStr) {
    await supabase.from('job_changes').insert({
      job_id: current?.job_id ?? null,
      call_log_id: current?.jobs?.call_log_id ?? null,
      field: `job_wtc.field_sow:${jobWtcId}`,
      old_value: oldStr,
      new_value: newStr,
      changed_by: changedBy,
      source,
    })
  }

  return { error: null }
}

// ── job_material_lines: SOW→tracker write path (DMS-1 Phase 3 §1/§2) ─────────
// The canonical Needed rollup lands here. The writer SETs ONLY the SOW-derived
// columns (name/kit_size/coverage/supplier/qty_needed/coverage_status/
// coverage_reason); the warehouse-owned columns (qty_ordered/status/arrival_date/
// notes + receiving fields) are NEVER in the upsert payload, so ON CONFLICT never
// clobbers them. One row per REAL logical need (rollup grain, REG-4).

const JML_SELECT = 'id, job_id, material_key, name, kit_size, coverage, supplier, qty_needed, qty_ordered, coverage_status, coverage_reason, status, arrival_date, notes'

// Read all tracker rows for a job (Logistics view). Joined to the rollup in the UI.
export async function loadJobMaterialLines(jobId) {
  const { data, error } = await supabase
    .from('job_material_lines')
    .select(JML_SELECT)
    .eq('job_id', jobId)
    .order('name')
  return { data: data || [], error: error || null }
}

// Rebuild the tracker from the job's CURRENT SOW. Runs on every SOW save AND
// lazily on Logistics-tab open (seeds jobs sent before this feature). Rolls up
// every WTC's field_sow (legacy zero-WTC jobs fall back to jobs.field_sow),
// upserts one row per need (SOW-derived cols only), deletes rows whose material
// was removed from the SOW (orphan cleanup), and audit-logs the deltas.
export async function syncJobMaterialLines(jobId, changedBy, source = 'schedule_command') {
  const jid = parseInt(jobId)
  const [{ data: job }, { data: wtcs }, { data: existingRows }] = await Promise.all([
    supabase.from('jobs').select('call_log_id, field_sow').eq('job_id', jid).single(),
    supabase.from('job_wtcs').select('field_sow').eq('job_id', jid),
    supabase.from('job_material_lines').select('material_key, name, qty_needed, qty_ordered, coverage_status, coverage_reason').eq('job_id', jid),
  ])
  const callLogId = job?.call_log_id ?? null
  const sows = (wtcs && wtcs.length) ? wtcs.map(w => w.field_sow) : [job?.field_sow]
  const needs = sows.flatMap(fs => rollupSowMaterials(Array.isArray(fs) ? fs : []))

  // Dedupe across WTCs by material_key (unique per source; last wins).
  const byKey = new Map()
  for (const n of needs) byKey.set(n.material_key, n)
  const finalNeeds = [...byKey.values()]

  const existingByKey = new Map((existingRows || []).map(r => [r.material_key, r]))

  // Build upsert rows — SOW-derived columns ONLY. coverage_status is re-derived
  // from the row's EXISTING qty_ordered (warehouse-owned; unchanged here).
  const rows = finalNeeds.map(n => {
    const ex = existingByKey.get(n.material_key)
    return {
      job_id: jid,
      material_key: n.material_key,
      name: n.name,
      kit_size: n.kit_size,
      coverage: n.coverage,
      supplier: n.supplier,
      qty_needed: n.qty_needed,
      coverage_status: coverageStatusFor(n.qty_needed, ex?.qty_ordered ?? 0, n.coverage_reason),
      coverage_reason: n.coverage_reason,
    }
  })

  if (rows.length) {
    const { error } = await supabase.from('job_material_lines').upsert(rows, { onConflict: 'job_id,material_key' })
    if (error) return { error }
  }

  // Orphan cleanup: rows whose material was removed from the SOW. Warehouse-added
  // rows (material_key `wh_…`, R5 — not on the SOW) are EXCLUDED so a SOW re-sync
  // never deletes them.
  const keep = new Set(finalNeeds.map(n => n.material_key))
  const orphans = (existingRows || []).map(r => r.material_key)
    .filter(k => !keep.has(k) && !String(k).startsWith('wh_'))
  if (orphans.length) {
    const { error: delErr } = await supabase.from('job_material_lines').delete().eq('job_id', jid).in('material_key', orphans)
    if (delErr) return { error: delErr }
  }

  // Audit-log the deltas, line-identified by material_key (round-3 item 5).
  // Compare qty_needed NUMERICALLY (T5 hardening): PostgREST may round-trip a
  // `numeric` back as a string, so a raw JSON compare would log a phantom "change"
  // every sync for a fractional need (e.g. 1000/3). Number() normalizes both sides.
  const sameNum = (a, b) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b))
  const logs = []
  for (const r of rows) {
    const ex = existingByKey.get(r.material_key)
    const before = ex ? { qty_needed: ex.qty_needed, coverage_status: ex.coverage_status, coverage_reason: ex.coverage_reason } : null
    const after = { qty_needed: r.qty_needed, coverage_status: r.coverage_status, coverage_reason: r.coverage_reason }
    const changed = !ex
      || !sameNum(ex.qty_needed, r.qty_needed)
      || (ex.coverage_status ?? null) !== (r.coverage_status ?? null)
      || (ex.coverage_reason ?? null) !== (r.coverage_reason ?? null)
    if (changed) {
      logs.push({ job_id: jid, call_log_id: callLogId, field: `material_line[${r.material_key}].sync`,
        old_value: before ? JSON.stringify(before) : null, new_value: JSON.stringify(after), changed_by: changedBy, source })
    }
  }
  for (const k of orphans) {
    const ex = existingByKey.get(k)
    logs.push({ job_id: jid, call_log_id: callLogId, field: `material_line[${k}].removed`,
      old_value: ex?.name || k, new_value: null, changed_by: changedBy, source })
  }
  if (logs.length) await supabase.from('job_changes').insert(logs)

  return { error: null }
}

// Warehouse-add (Step 4, R5): a material NOT on the SOW. Direct job_material_lines
// row with a `wh_` key (excluded from SOW orphan cleanup), UNASSIGNED to any task →
// qty_needed null / VERIFY / NO_TASK_TAG (amber can't-tell); the warehouse types
// Ordered directly. Audit-logged. Does not touch the frozen SOW.
export async function addWarehouseMaterialLine(jobId, item, changedBy, source = 'schedule_command') {
  const jid = parseInt(jobId)
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const material_key = `wh_${rnd}`
  const row = {
    job_id: jid,
    material_key,
    name: item.name || 'Unnamed material',
    kit_size: item.kit_size || null,
    coverage: item.coverage || item.coverage_rate || null,
    supplier: item.supplier || null,
    qty_needed: null,
    coverage_status: 'VERIFY',
    coverage_reason: 'NO_TASK_TAG',
  }
  const { error } = await supabase.from('job_material_lines').insert(row)
  if (error) return { error }
  const { data: job } = await supabase.from('jobs').select('call_log_id').eq('job_id', jid).single()
  await supabase.from('job_changes').insert({
    job_id: jid, call_log_id: job?.call_log_id ?? null,
    field: `material_line[${material_key}].added`, old_value: null, new_value: row.name,
    changed_by: changedBy, source,
  })
  return { error: null, material_key }
}

// Warehouse edit of a tracker row (qty_ordered/status/arrival_date/notes). Bespoke
// (not updateJobField) but STILL audit-logged, line-identified by material_key. A
// qty_ordered change re-derives coverage_status from the stored qty_needed + reason.
const JML_WAREHOUSE_FIELDS = ['qty_ordered', 'status', 'arrival_date', 'notes']
export async function updateJobMaterialLineField(jobId, materialKey, updates, changedBy, source = 'schedule_command') {
  const jid = parseInt(jobId)
  const { data: current, error: readErr } = await supabase
    .from('job_material_lines')
    .select('qty_needed, qty_ordered, coverage_status, coverage_reason, status, arrival_date, notes')
    .eq('job_id', jid).eq('material_key', materialKey).single()
  if (readErr) return { error: readErr }

  // Only warehouse-owned fields may be written through here.
  const payload = {}
  for (const f of JML_WAREHOUSE_FIELDS) if (f in updates) payload[f] = updates[f]

  // A qty_ordered change re-derives the stored coverage_status (OK/SHORT/VERIFY).
  if ('qty_ordered' in payload) {
    payload.coverage_status = coverageStatusFor(current.qty_needed, payload.qty_ordered ?? 0, current.coverage_reason)
  }

  const { error } = await supabase.from('job_material_lines').update(payload).eq('job_id', jid).eq('material_key', materialKey)
  if (error) return { error }

  const { data: job } = await supabase.from('jobs').select('call_log_id').eq('job_id', jid).single()
  const logs = []
  for (const f of Object.keys(payload)) {
    const oldV = String(current?.[f] ?? '')
    const newV = String(payload[f] ?? '')
    if (oldV !== newV) {
      logs.push({ job_id: jid, call_log_id: job?.call_log_id ?? null, field: `material_line[${materialKey}].${f}`,
        old_value: oldV || null, new_value: newV || null, changed_by: changedBy, source })
    }
  }
  if (logs.length) await supabase.from('job_changes').insert(logs)

  return { error: null }
}

// ── job_assets: assign tenant vehicles/equipment/power to a job (Step 5) ────
// The per-JOB link (job ↔ tenant asset, per-job Available/Unavailable). The
// tenant_* lists stay the source of truth for the asset itself; job_assets is
// only the assignment. All writes audit-logged to job_changes.

export async function loadTenantAssets() {
  const [v, e, p] = await Promise.all([
    supabase.from('tenant_vehicles').select('id, name').eq('active', true).order('name'),
    supabase.from('tenant_equipment').select('id, name').eq('active', true).order('name'),
    supabase.from('tenant_power').select('id, name').eq('active', true).order('name'),
  ])
  return { vehicles: v.data || [], equipment: e.data || [], power: p.data || [], error: v.error || e.error || p.error || null }
}

export async function loadJobAssets(jobId) {
  const { data, error } = await supabase
    .from('job_assets')
    .select('id, job_id, asset_type, asset_id, available')
    .eq('job_id', parseInt(jobId))
  return { data: data || [], error: error || null }
}

async function logJobChange(jid, field, oldV, newV, changedBy, source) {
  const { data: job } = await supabase.from('jobs').select('call_log_id').eq('job_id', jid).single()
  await supabase.from('job_changes').insert({
    job_id: jid, call_log_id: job?.call_log_id ?? null, field,
    old_value: oldV == null ? null : String(oldV), new_value: newV == null ? null : String(newV),
    changed_by: changedBy, source,
  })
}

export async function addJobAsset(jobId, assetType, assetId, changedBy, source = 'schedule_command') {
  const jid = parseInt(jobId)
  const { data, error } = await supabase
    .from('job_assets')
    .insert({ job_id: jid, asset_type: assetType, asset_id: assetId, available: true })
    .select('id').single()
  if (error) return { error }
  await logJobChange(jid, `job_asset[${assetType}].added`, null, assetId, changedBy, source)
  return { error: null, id: data?.id }
}

export async function setJobAssetAvailable(jobId, id, available, changedBy, source = 'schedule_command') {
  const jid = parseInt(jobId)
  const { error } = await supabase.from('job_assets').update({ available }).eq('id', id).eq('job_id', jid)
  if (error) return { error }
  await logJobChange(jid, `job_asset[${id}].available`, null, available, changedBy, source)
  return { error: null }
}

export async function removeJobAsset(jobId, id, changedBy, source = 'schedule_command') {
  const jid = parseInt(jobId)
  const { error } = await supabase.from('job_assets').delete().eq('id', id).eq('job_id', jid)
  if (error) return { error }
  await logJobChange(jid, `job_asset[${id}].removed`, id, null, changedBy, source)
  return { error: null }
}

// ── Job mobilizations — write path (Phase F, F2a) ───────────────────────────
// No job_mobilizations writer existed in Schedule before Phase F (reads only),
// and updateJobField is jobs-table-only — so these named helpers do the table
// write AND log a job_changes row via logJobChange (audit D1/H). D3 wants
// go-back add/delete countable in the audit log, so every write logs.

// Authoritative row list for the editor: read job_mobilizations rows DIRECTLY
// (audit C1), not the day-derived getJobMobilizations array — a freshly-added
// dayless go-back has no tagged days yet, so it only exists as a table row.
export async function loadJobMobilizationRows(jobId) {
  const { data, error } = await supabase
    .from('job_mobilizations')
    .select('id, job_id, seq, label, start_date, end_date, is_go_back')
    .eq('job_id', parseInt(jobId))
    .order('seq', { ascending: true })
  if (error) { console.warn('[mobs] could not load job_mobilizations rows:', error.message); return { data: [], error } }
  return { data: data || [], error: null }
}

// Add a mobilization to a live job. `seq` is computed by the caller as max+1 over
// BOTH existing rows AND every day's mobilization_seq (audit O2), so a new mob
// can't collide with a seq that lives only on tagged days. is_go_back distinguishes
// a tracked return trip (+ Add Go Back) from rescheduled sold work (+ Add trip).
export async function addJobMobilization(jobId, { seq, label, start_date, end_date, is_go_back }, changedBy, source = 'schedule_mobs') {
  const jid = parseInt(jobId)
  const { data, error } = await supabase
    .from('job_mobilizations')
    .insert({ job_id: jid, seq, label: label || null, start_date: start_date || null, end_date: end_date || null, is_go_back: !!is_go_back })
    .select('id, job_id, seq, label, start_date, end_date, is_go_back').single()
  if (error) return { data: null, error }
  await logJobChange(jid, `mobilization[${seq}].added`, null, `${is_go_back ? 'go_back' : 'trip'}: ${label || `Mob ${seq}`}`, changedBy, source)
  return { data, error: null }
}

// Edit an existing mobilization's label/dates (never seq or is_go_back — identity
// and go-back classification are fixed at creation). Logs the label change.
export async function updateJobMobilization(jobId, mobRow, { label, start_date, end_date }, changedBy, source = 'schedule_mobs') {
  const jid = parseInt(jobId)
  const { data, error } = await supabase
    .from('job_mobilizations')
    .update({ label: label || null, start_date: start_date || null, end_date: end_date || null })
    .eq('id', mobRow.id)
    .select('id, job_id, seq, label, start_date, end_date, is_go_back').single()
  if (error) return { data: null, error }
  await logJobChange(jid, `mobilization[${mobRow.seq}].edited`, mobRow.label || null, label || null, changedBy, source)
  return { data, error: null }
}

// Delete a mobilization. Two-part in-use scan (audit C1), split by reversibility:
//  (1) pull_tickets by job_mobilization_id = HARD BLOCK, no override — the FK is
//      ON DELETE CASCADE, so deleting would silently destroy pull tickets + their
//      lines + per-mob ticket numbering (irreversible). Returns {blocked:true}.
//  (2) field_sow day-tags across the job's WTCs (by mobilization_seq) = recoverable
//      (days can be re-tagged), so the CALLER warns + confirms BEFORE calling this.
// Never collapse the two into one confirm→proceed (that would allow click-through
// pull-ticket loss). The scan works because the editor reads rows directly, so
// mobRow carries the job_mobilizations `id` the FK points at.
// Count pull tickets on a mobilization — the hard-block signal. Separable from
// deleteJobMobilization so the UI can check the block BEFORE asking the user to
// confirm the (recoverable) field_sow tag loss, instead of confirm-then-block.
export async function countPullTicketsForMob(mobId) {
  const { data, error } = await supabase.from('pull_tickets').select('id').eq('job_mobilization_id', mobId)
  if (error) return { count: 0, error }
  return { count: data?.length || 0, error: null }
}

export async function deleteJobMobilization(jobId, mobRow, changedBy, source = 'schedule_mobs') {
  const jid = parseInt(jobId)
  // (1) HARD BLOCK: any pull ticket on this mob makes delete a data-loss operation.
  // Authoritative re-check even when the caller pre-checked (belt-and-suspenders).
  const { count: ptCount, error: ptErr } = await countPullTicketsForMob(mobRow.id)
  if (ptErr) return { error: ptErr }
  if (ptCount > 0) return { blocked: true, pullTicketCount: ptCount }

  const { error } = await supabase.from('job_mobilizations').delete().eq('id', mobRow.id)
  if (error) return { error }
  await logJobChange(jid, `mobilization[${mobRow.seq}].deleted`, mobRow.label || `Mob ${mobRow.seq}`, null, changedBy, source)
  return { error: null }
}

// ── Tenant asset lists — Settings editor (Step 6) ───────────────────────────
// Minimal per-tenant CRUD over the live tenant_* tables. "Delete" = soft-delete
// (active=false) because a forbid-hard-delete guard blocks real deletes. tenant_id
// is NOT NULL with no default, so inserts supply it from get_user_tenant_id().
const TENANT_ASSET_TABLE = { vehicle: 'tenant_vehicles', equipment: 'tenant_equipment', power: 'tenant_power' }

export async function getUserTenantId() {
  const { data, error } = await supabase.rpc('get_user_tenant_id')
  return { tenantId: data ?? null, error: error || null }
}

export async function loadTenantAssetList(type) {
  const table = TENANT_ASSET_TABLE[type]
  if (!table) return { data: [], error: new Error(`unknown asset type ${type}`) }
  const { data, error } = await supabase.from(table).select('id, name, active').eq('active', true).order('name')
  return { data: data || [], error: error || null }
}

export async function addTenantAsset(type, name) {
  const table = TENANT_ASSET_TABLE[type]
  if (!table) return { error: new Error(`unknown asset type ${type}`) }
  const { tenantId, error: tErr } = await getUserTenantId()
  if (tErr) return { error: tErr }
  if (!tenantId) return { error: new Error('Could not resolve your tenant') }
  const { error } = await supabase.from(table).insert({ name: name.trim(), tenant_id: tenantId })
  return { error: error || null }
}

export async function renameTenantAsset(type, id, name) {
  const table = TENANT_ASSET_TABLE[type]
  if (!table) return { error: new Error(`unknown asset type ${type}`) }
  const { error } = await supabase.from(table).update({ name: name.trim() }).eq('id', id)
  return { error: error || null }
}

export async function deactivateTenantAsset(type, id) {
  const table = TENANT_ASSET_TABLE[type]
  if (!table) return { error: new Error(`unknown asset type ${type}`) }
  const { error } = await supabase.from(table).update({ active: false }).eq('id', id)
  return { error: error || null }
}

// ── Billing forecast + worklist (billing-forecast feature) ──────────────────
// Reads canonical Sales-owned invoices read-only (no writes to Sales tables).
// The only Schedule-owned write target is billing_worklist (manual overrides).

// Allowed manual-override fields on billing_worklist (plan §6.4 D3).
export const BILLING_WORKLIST_FIELDS = [
  'hold_sales',
  'hold_reason',
  'nothing_to_bill',
  'terms_override',
  'chris_notes',
]

// Forecast source read (plan §4.1, pinned signature §4.1 N5 / C3 / C6).
// Sent, unpaid, non-void, non-deleted canonical invoices + the joins the
// forecast needs: customer billing_terms and tenant default_billing_terms for
// the §4.2 expected-pay-date fallback. Routed through loadAllRows so the read
// pages past PostgREST's 1000-row cap (C3) — never fetch this set unpaginated.
// Returns { data, error, partial }; surface partial as a "counts may be stale" warning.
export async function loadInvoicesForForecast() {
  return loadAllRows(
    'invoices',
    'id, call_log_id, amount, discount, retention_amount, retention_release_of, ' +
      'sent_at, due_date, status, tenant_id, ' +
      'call_log:call_log_id(display_job_number, customer_id, ' +
      'customers:customer_id(billing_terms)), ' +
      'tenant_config:tenant_id(default_billing_terms)',
    {
      orderBy: 'id',
      filterFn: (chain) =>
        chain
          .is('voided_at', null)
          .is('deleted_at', null)
          .is('paid_at', null)
          .not('sent_at', 'is', null),
    },
  )
}

// Read all billing_worklist override rows (sparse table; one row per flagged job).
// Returns { data, error }.
export async function loadBillingWorklist() {
  const { data, error } = await supabase.from('billing_worklist').select('*')
  return { data: data || [], error }
}

// Assemble everything the worklist + forecast need, in parallel. Reads canonical
// Sales tables read-only. Invoices are ALL active (incl. paid + qb_invoice_id)
// so status derivation can see paid/QB state; the forecast filters to unpaid in
// JS. Embeds flatten onto each invoice as _billing_terms / _default_billing_terms
// / _customer_id / _display_job_number / _requires_pay_app. All reads paginate
// (proposals exceed 1000). Returns { invoices, proposals, schedules, payApps,
// overrides, partial } — partial=true ⇒ a page truncated, counts may be stale.
export async function loadBillingSurfaceData() {
  const INVOICE_SEL =
    'id, call_log_id, proposal_id, amount, discount, retention_amount, retention_release_of, ' +
    'sent_at, paid_at, due_date, status, qb_invoice_id, tenant_id, ' +
    'call_log:call_log_id(display_job_number, customer_id, ' +
    'customers:customer_id(billing_terms, requires_pay_app)), ' +
    'tenant_config:tenant_id(default_billing_terms)'

  const [invRes, propRes, schedRes, payAppRes, wlRes] = await Promise.all([
    loadAllRows('invoices', INVOICE_SEL, {
      orderBy: 'id',
      filterFn: (c) => c.is('voided_at', null).is('deleted_at', null),
    }),
    loadAllRows('proposals', 'id, call_log_id, status, total, is_archive_proposal', { orderBy: 'id' }),
    loadAllRows('billing_schedule', 'id, proposal_id, contract_sum, retainage_pct, status', { orderBy: 'id' }),
    loadAllRows('billing_schedule_pay_apps', 'id, invoice_id, status, submitted_at, app_number', { orderBy: 'id' }),
    loadBillingWorklist(),
  ])

  const invoices = (invRes.data || []).map((i) => {
    const cl = i.call_log || {}
    const cust = cl.customers || {}
    return {
      ...i,
      _display_job_number: cl.display_job_number ?? null,
      _customer_id: cl.customer_id ?? null,
      _billing_terms: cust.billing_terms ?? null,
      _requires_pay_app: cust.requires_pay_app ?? false,
      _default_billing_terms: i.tenant_config?.default_billing_terms ?? null,
    }
  })

  const partial = Boolean(invRes.partial || propRes.partial || schedRes.partial || payAppRes.partial)

  return {
    invoices,
    proposals: propRes.data || [],
    schedules: schedRes.data || [],
    payApps: payAppRes.data || [],
    overrides: wlRes.data || [],
    partial,
  }
}

// Write a single manual-override field to billing_worklist, audit-logged to
// job_changes (plan §6.4 D3). Pinned signature: setBillingWorklistFlag(jobId,
// field, value, changedBy). Upserts the sparse row keyed on job_id; no raw
// billing_worklist writes belong in views.
export async function setBillingWorklistFlag(jobId, field, value, changedBy, source = 'schedule_command') {
  if (!BILLING_WORKLIST_FIELDS.includes(field)) {
    return { error: new Error(`setBillingWorklistFlag: invalid field '${field}'`) }
  }

  // read current override value (for old→new audit) + the job's call_log_id
  const { data: currentRow } = await supabase
    .from('billing_worklist')
    .select(field)
    .eq('job_id', jobId)
    .maybeSingle()
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('call_log_id')
    .eq('job_id', jobId)
    .single()

  const oldValue = currentRow ? String(currentRow[field] ?? '') : ''
  const newStr = String(value ?? '')

  // upsert the sparse row (creates with defaults, or updates just this field)
  const { error } = await supabase
    .from('billing_worklist')
    .upsert({ job_id: jobId, [field]: value }, { onConflict: 'job_id' })

  if (error) return { error }

  if (newStr !== oldValue) {
    await supabase.from('job_changes').insert({
      job_id: jobId,
      call_log_id: jobRow?.call_log_id || null,
      field: `billing_worklist.${field}`,
      old_value: oldValue || null,
      new_value: newStr || null,
      changed_by: changedBy,
      source,
    })
  }

  return { error: null }
}
