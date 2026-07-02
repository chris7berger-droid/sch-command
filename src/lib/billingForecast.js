// Billing triage worklist + 90-day cash-flow forecast — pure logic.
//
// No I/O here: every function takes already-loaded data and returns derived
// state, so the math is testable against real rows without a UI. Data is
// assembled by queries.loadBillingSurfaceData(). Section refs are to
// docs/plans/billing_forecast_integration.md.

import { getJobStatus } from './jobStatus'

// ── numeric coercion ────────────────────────────────────────────────────────
// jobs.amount is a "$45,000" string; invoice numerics may arrive as strings.
export function num(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ── proposal selection / authoritative total (§3.2 A2/A4/N2) ─────────────────
// A live, non-archive proposal in a sold/signed state. 'Signed' lands once
// Multi-GC ships (§2.4); accept it now so we don't regress when it does.
const LIVE_PROPOSAL_STATUSES = new Set(['sold', 'signed'])

export function isLiveSoldProposal(p) {
  return p && p.is_archive_proposal === false &&
    LIVE_PROPOSAL_STATUSES.has(String(p.status || '').toLowerCase().trim())
}

// authoritative_total = contract_sum WHEN > 0 (real SOV) else proposal.total.
// Returns { total, resolved, proposalId, ambiguous }. resolved=false ⇒ no live
// proposal found (a zero-invoice row stays Needs-Triage, never sums vs archive).
export function authoritativeTotal(callLogId, proposalsByCallLog, scheduleByProposal, invoices) {
  const live = (proposalsByCallLog.get(callLogId) || []).filter(isLiveSoldProposal)

  let proposal = null
  let ambiguous = false
  if (live.length === 1) {
    proposal = live[0]
  } else if (live.length > 1) {
    // multi-GC: disambiguate by the proposal this job's invoices belong to (A4).
    const invProposalIds = new Set((invoices || []).map((i) => i.proposal_id).filter(Boolean))
    const matched = live.filter((p) => invProposalIds.has(p.id))
    if (matched.length === 1) proposal = matched[0]
    else ambiguous = true // N2: can't disambiguate → unresolved, surfaces Needs-Triage
  }

  if (!proposal) return { total: 0, resolved: false, proposalId: null, ambiguous }

  const sched = scheduleByProposal.get(proposal.id)
  const contractSum = num(sched?.contract_sum)
  const total = contractSum > 0 ? contractSum : num(proposal.total)
  return { total, resolved: total > 0, proposalId: proposal.id, ambiguous: false }
}

// ── invoice predicates / sums ────────────────────────────────────────────────
export function isActiveInvoice(i) {
  return i && i.voided_at == null && i.deleted_at == null
}
// A sent invoice = actually sent (A3): sent_at present, or a sent-ish status.
const SENT_STATUSES = new Set(['sent', 'waiting for payment', 'past due'])
export function isSent(i) {
  return i.sent_at != null || SENT_STATUSES.has(String(i.status || '').toLowerCase().trim())
}
export function isPaid(i) {
  return i.paid_at != null || String(i.status || '').toLowerCase().trim() === 'paid'
}

// billed_total (§3.2 A1/A3): Σ gross amount over the call_log's invoices that
// are active, actually sent, and NOT retention-release rows (A1: releases
// re-bill already-counted dollars). Coverage is gross-vs-gross (authoritative
// total is a gross contract sum).
export function billedTotal(invoices) {
  let total = 0
  for (const i of invoices) {
    if (!isActiveInvoice(i)) continue
    if (!isSent(i)) continue
    if (i.retention_release_of != null) continue // A1
    total += num(i.amount)
  }
  return total
}

// net collectable on an invoice (§4.5 C2/N1): gross − discount − retention,
// each COALESCEd to 0 so a NULL column nets to full amount (never amount−NULL).
export function netOfInvoice(i) {
  return num(i.amount) - num(i.discount) - num(i.retention_amount)
}

// ── worklist status derivation (§3, ordered per B3/N3/§8.1c) ──────────────────
export const WL_STATUS = {
  ALL_READY_BILLED: 'All Ready Billed',
  HOLD_SALES: 'Hold – Sales',
  NOTHING_TO_BILL: 'Nothing to Bill',
  SENT_TO_QB: 'Invoice Sent to QB',
  SENT: 'Invoice Sent',
  NEEDS_TRIAGE: 'Needs Triage',
}

// "Sent to QB / portal" half-derivation (§8.1c #5): for pay-app GCs, a submitted
// pay app == submitted to portal; for regular GCs, qb_invoice_id present.
function isQbOrPortalSent(invoices, requiresPayApp, payAppsByInvoice) {
  for (const i of invoices) {
    if (!isActiveInvoice(i) || !isSent(i)) continue
    if (i.qb_invoice_id) return true
    if (requiresPayApp) {
      const pa = payAppsByInvoice.get(i.id)
      if (pa && String(pa.status || '').toLowerCase() === 'submitted') return true
    }
  }
  return false
}

// Resolve one worklist row's status. fully_billed dominates (B3/N3); manual
// flags override the auto sent/triage states; Paid is folded into All-Ready-
// Billed display via the allPaid flag (no separate actionable Paid row in v1).
export function deriveStatus({
  fullyBilled, override, invoices, requiresPayApp, payAppsByInvoice,
}) {
  if (fullyBilled) return WL_STATUS.ALL_READY_BILLED          // 1 — terminal
  if (override?.hold_sales) return WL_STATUS.HOLD_SALES        // manual
  if (override?.nothing_to_bill) return WL_STATUS.NOTHING_TO_BILL // manual
  if (isQbOrPortalSent(invoices, requiresPayApp, payAppsByInvoice)) return WL_STATUS.SENT_TO_QB // 3
  if (invoices.some((i) => isActiveInvoice(i) && isSent(i))) return WL_STATUS.SENT // 4
  return WL_STATUS.NEEDS_TRIAGE                                // work done, nothing sent
}

// ── population: the hybrid trigger (§8.1c #4) ────────────────────────────────
// Returns { populates, arm } where arm ∈ 'deposit' | 'production' | null.
//   (a) deposit/first-bill: live Sold proposal AND billed < authoritative — no
//       production signal needed (catches deposits before any man-hour).
//   (b) progress/draw: partially billed AND production advanced this week
//       (Complete OR scheduled_end/end_date this week OR partial_bill_date this
//        week). v1 production signal only; man-hours/DPR is the staged upgrade.
export function populationArm(job, { hasLiveSoldProposal, billed, authoritative, weekStart, weekEnd }) {
  const hasBalance = authoritative > 0 && billed < authoritative
  // (a) deposit / FIRST bill: sold, nothing billed yet — no production signal.
  // Tightened to billed<=0 (the plan's "first-bill" intent); the loose §8.1c
  // text `billed < authoritative` wrongly labels partial draws as deposits.
  if (hasLiveSoldProposal && billed <= 0 && hasBalance) return 'deposit'
  // (b) progress / draw: already partially billed AND production advanced this
  // week — so a mid-production job isn't re-nagged weekly with nothing new.
  if (billed > 0 && hasBalance && productionThisWeek(job, weekStart, weekEnd)) return 'production'

  return null
}

function inWeek(dateStr, weekStart, weekEnd) {
  if (!dateStr) return false
  const d = String(dateStr).split('T')[0]
  return d >= weekStart && d <= weekEnd
}

// v1 production signal (§8.1c arm b): Complete, or an end/partial-bill date that
// has landed (this week or earlier — earlier = overdue, still actionable).
export function productionThisWeek(job, weekStart, weekEnd) {
  const status = String(job.status || '').toLowerCase().trim()
  if (status === 'complete' || status === 'completed' || status === 'done') return true
  const end = job.scheduled_end || job.end_date
  if (end && String(end).split('T')[0] <= weekEnd) return true
  if (job.partial_billing === 'Yes' && inWeek(job.partial_bill_date, weekStart, weekEnd)) return true
  return false
}

// ── expected pay date (§4.2, precedence C4) ──────────────────────────────────
// 1) terms_override applied to sent_at (wins over due_date)
// 2) due_date
// 3) sent_at + COALESCE(billing_terms, default_billing_terms, 30)  [ADJ-4: terms_override is step 1 only]
export function expectedPayDate(inv, termsOverride) {
  const sent = inv.sent_at ? new Date(String(inv.sent_at).split('T')[0] + 'T00:00:00') : null
  if (termsOverride && sent) return addDays(sent, termsOverride)
  if (inv.due_date) return new Date(String(inv.due_date).split('T')[0] + 'T00:00:00')
  if (sent) {
    // termsOverride is provably falsy here — step 1 above already returns when
    // (termsOverride && sent), and we're inside `if (sent)` [ADJ-4].
    const terms = inv._billing_terms || inv._default_billing_terms || 30
    return addDays(sent, terms)
  }
  return null
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  r.setHours(0, 0, 0, 0)
  return r
}

// ── 90-day forecast (§4.3/§4.5) ──────────────────────────────────────────────
// invoices: forecast-eligible (sent, unpaid, active). getMonday: from weeks.js.
// termsOverrideByCallLog: Map<call_log_id, int> from billing_worklist via jobs.
// Returns { pastDue, weeks[], heldRetention } each with { sum, count, invoices }.
export function computeForecast(invoices, termsOverrideByCallLog, today, getMonday) {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0)
  const horizon = addDays(t0, 90)
  const firstMonday = getMonday(t0)

  // pre-build the weekly bucket skeleton (Monday-anchored, today→+90d)
  const weeks = []
  const weekIndex = new Map() // 'YYYY-MM-DD' Monday -> weeks[] position
  for (let m = new Date(firstMonday); m <= horizon; m = addDays(m, 7)) {
    weekIndex.set(fmtKey(m), weeks.length)
    weeks.push({ monday: new Date(m), sum: 0, count: 0, invoices: [] })
  }

  const pastDue = { sum: 0, count: 0, invoices: [] }
  const heldRetention = { sum: 0, count: 0, invoices: [] }

  for (const inv of invoices) {
    // held retention shown as its own bucket, excluded from inflow (§4.5)
    const held = num(inv.retention_amount)
    if (held > 0 && inv.retention_release_of == null) {
      heldRetention.sum += held
      heldRetention.count += 1
      // carry the held amount as _net + a null _expected (release date unknown)
      // so the retention drill-in renders in the same forecast card as inflow.
      heldRetention.invoices.push({ ...inv, _net: held, _expected: null })
    }

    const net = netOfInvoice(inv)
    if (net <= 0) continue // N9: nothing collectable

    const exp = expectedPayDate(inv, termsOverrideByCallLog.get(inv.call_log_id))
    if (!exp) continue

    const row = { ...inv, _net: net, _expected: exp }
    if (exp < t0) {
      pastDue.sum += net; pastDue.count += 1; pastDue.invoices.push(row) // C5
      continue
    }
    if (exp > horizon) continue // beyond the 90-day window

    const idx = weekIndex.get(fmtKey(getMonday(exp)))
    if (idx == null) continue
    weeks[idx].sum += net
    weeks[idx].count += 1
    weeks[idx].invoices.push(row)
  }

  return { pastDue, weeks, heldRetention }
}

function fmtKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── orchestration: jobs + assembled data → worklist rows + forecast ──────────
// data = output of queries.loadBillingSurfaceData(). getMonday from weeks.js.
// One row per job (per call_log grain §3.0a; each CO is its own jobs row → own
// row). Returns { rows, forecast, termsOverrideByCallLog }.
export function buildBillingSurface(jobs, data, today, getMonday) {
  const { invoices, proposals, schedules, payApps, overrides } = data

  // index everything once
  const proposalsByCallLog = groupBy(proposals, (p) => p.call_log_id)
  const scheduleByProposal = new Map(schedules.map((s) => [s.proposal_id, s]))
  const invoicesByCallLog = groupBy(invoices, (i) => i.call_log_id)
  const overridesByJobId = new Map(overrides.map((o) => [String(o.job_id), o]))
  // pay app per invoice — prefer a submitted one if multiple
  const payAppsByInvoice = new Map()
  for (const pa of payApps) {
    if (pa.invoice_id == null) continue
    const cur = payAppsByInvoice.get(pa.invoice_id)
    if (!cur || String(pa.status).toLowerCase() === 'submitted') payAppsByInvoice.set(pa.invoice_id, pa)
  }

  const mon = getMonday(new Date(today))
  const weekStart = fmtKey(mon)
  const weekEnd = fmtKey(addDays(mon, 5))

  const rows = []
  for (const job of jobs) {
    if (job.no_bill === 'Yes') continue // §3.3 exclude no_bill (deleted already excluded by loadJobs)
    // §1d (billing-redesign r1): population gate — exclude jobs still 'Parked'.
    // A job leaves 'Parked' the moment Schedule confirms it, so raw lifecycle
    // status is the "scheduled" signal. NOT a date proxy (scheduled jobs often
    // have null scheduled_end/end_date) and NOT getJobStatus() (a derived billing
    // status, wrong axis). Deposits + all billable work surface only once off Parked.
    if (String(job.status || '').trim() === 'Parked') continue

    const callLogId = job.call_log_id
    const jobInvoices = invoicesByCallLog.get(callLogId) || []
    const liveProps = (proposalsByCallLog.get(callLogId) || []).filter(isLiveSoldProposal)
    const hasLiveSoldProposal = liveProps.length > 0

    const auth = authoritativeTotal(callLogId, proposalsByCallLog, scheduleByProposal, jobInvoices)
    const billed = billedTotal(jobInvoices)
    const fullyBilled = auth.resolved && billed >= auth.total

    const override = overridesByJobId.get(String(job.job_id))
    // Invoice-derived pay-app flag — used ONLY by deriveStatus. Distinct from the
    // job-row `requiresPayApp` emitted on the row below (B1 name-collision note):
    // that one comes off the loadJobs call_log→customers embed and drives the Pay
    // Apps card even for un-invoiced jobs; this one hangs off the invoice join.
    const requiresPayAppInvoice = jobInvoices.some((i) => i._requires_pay_app)
    const status = deriveStatus({ fullyBilled, override, invoices: jobInvoices, requiresPayApp: requiresPayAppInvoice, payAppsByInvoice })

    const arm = populationArm(job, {
      hasLiveSoldProposal, billed, authoritative: auth.total, weekStart, weekEnd,
    })

    // a row surfaces if the trigger fired, a manual flag is set, or there are
    // sent invoices that still need follow-up (Sent / Sent-to-QB / fully billed)
    const sentInvoices = jobInvoices.filter((i) => isActiveInvoice(i) && isSent(i))
    const hasSent = sentInvoices.length > 0
    const surfaces = arm != null || !!override?.hold_sales || !!override?.nothing_to_bill || hasSent
    if (!surfaces) continue

    // N9 (§3.4): suppress $0-net rows from the actionable worklist — a job whose
    // sent invoices are fully retained/discounted (net <= 0) AND has no remaining
    // billable balance has nothing collectable to act on. Manual-flagged rows are
    // kept; deposit/draw rows (arm set, remaining > 0) are kept. Such rows stay
    // visible in the forecast drill-down / retention bucket, just not here.
    const remaining = auth.resolved ? Math.max(auth.total - billed, 0) : null
    const rowNet = sentInvoices.reduce((s, i) => s + netOfInvoice(i), 0)
    const nothingCollectable =
      !override?.hold_sales && !override?.nothing_to_bill &&
      hasSent && rowNet <= 0 && (remaining == null || remaining <= 0)
    if (nothingCollectable) continue

    const allPaid = hasSent && sentInvoices.every(isPaid)
    const lastSent = sentInvoices
      .filter((i) => i.sent_at)
      .map((i) => String(i.sent_at).split('T')[0])
      .sort()
      .pop() || null

    rows.push({
      jobId: job.job_id,
      callLogId,
      // Pay-app filter field — sourced off the JOB row (loadJobs call_log→customers
      // embed, C1/B1), so un-invoiced pay-app jobs still land in the Pay Apps card.
      // NOT requiresPayAppInvoice above (invoice-derived, deriveStatus-only).
      requiresPayApp: !!job.requires_pay_app,
      jobNum: job.job_num || job._display_job_number || jobInvoices[0]?._display_job_number || String(job.job_id),
      jobName: job.job_name || null,
      customerName: job.customer_name || null,
      workType: job.work_type || null,
      isChangeOrder: !!job.is_change_order,
      coNumber: job.co_number || null,
      status,
      arm,                       // 'deposit' | 'production' | null
      billed,
      authoritative: auth.total,
      authoritativeResolved: auth.resolved,
      ambiguous: auth.ambiguous,
      remaining,
      invoiceCount: jobInvoices.length,
      sentCount: sentInvoices.length,
      lastSent,
      allPaid,
      fullyBilled,
      // per-invoice breakdown (which invoices have gone out + amounts) for the
      // card's BILLING tab. Sent invoices only, oldest first.
      invoiceBreakdown: sentInvoices
        .map((i) => ({
          id: i.id,
          amount: num(i.amount),
          sentAt: i.sent_at ? String(i.sent_at).split('T')[0] : null,
          paid: isPaid(i),
        }))
        .sort((a, b) => (String(a.sentAt || '') < String(b.sentAt || '') ? -1 : 1)),
      historyLabel: historyLabel({ billed, authoritative: auth.total, fullyBilled, arm }),
      // production stage for the billing card's banner — the SAME mapping the
      // Jobs picker uses (getJobStatus), NOT raw jobs.status [rule #1 / B2].
      productionStage: getJobStatus(job),
      // greying signal for On-Hold rows inside their billing card [rule #1].
      // Kept separate from the derived billing `status` so neither is overloaded.
      heldSales: !!override?.hold_sales,
      override: override || null,
    })
  }

  // forecast: unpaid sent active invoices (§4.1), with per-call_log terms override
  const termsOverrideByCallLog = buildTermsOverrideMap(jobs, overridesByJobId)
  const forecastInvoices = invoices.filter((i) => isActiveInvoice(i) && isSent(i) && !isPaid(i))
  const forecast = computeForecast(forecastInvoices, termsOverrideByCallLog, today, getMonday)

  return { rows, forecast, termsOverrideByCallLog }
}

function historyLabel({ billed, authoritative, fullyBilled, arm }) {
  if (fullyBilled) return 'Fully billed'
  if (billed <= 0) return arm === 'deposit' ? 'Deposit due' : 'Nothing billed'
  if (authoritative > 0 && billed < authoritative) return 'Partially billed'
  return 'Billed'
}

// ── billing-state cards (BF-3, Phase-2 card-mapping decision) ────────────────
// The billing screen groups worklist rows by BILLING STATE into 4 cards, keyed
// off the DERIVED fields each row already carries (fullyBilled / historyLabel /
// authoritativeResolved) — NOT raw billed/authoritative [B1]. Pay Apps is an
// exclusive lane sourced off the JOB-row requiresPayApp [C1] and overrides the
// other three. Every shipped historyLabel state maps to exactly one card [E1].
export const BILLING_CARDS = [
  { key: 'ready',    label: 'Ready to Bill',   tone: 'ready',   desc: 'Sold work with nothing billed yet — deposits and first bills.' },
  { key: 'partial',  label: 'Partially Billed', tone: 'partial', desc: 'Billing started, balance still owed. Draws and follow-up bills.' },
  { key: 'complete', label: 'Billed Complete',  tone: 'complete', desc: 'Fully billed against the contract. The done pile.' },
  { key: 'payApps',  label: 'Pay Apps',         tone: 'payapps', desc: 'Pay-application customers (SOV / G702-G703) — their own lane.' },
]

// Which card a row belongs to. Order matters: Pay Apps overrides (exclusive),
// then fully-billed, then the partial/needs-review case, else Ready to Bill.
// Total coverage of historyLabel outputs — no row lands in zero or two cards.
export function billingCardKey(row) {
  if (row.requiresPayApp) return 'payApps'              // exclusive lane [C1]
  if (row.fullyBilled) return 'complete'               // 'Fully billed'
  // 'Partially billed', plus the billed-but-unresolved 'Billed' catch-all
  // (billed>0 but authoritative unresolved/ambiguous → flagged needs-review) [B1].
  if (row.historyLabel === 'Partially billed' || row.historyLabel === 'Billed') return 'partial'
  return 'ready'                                        // 'Deposit due' | 'Nothing billed'
}

// The billing badge shown on a card's banner-right slot. `needsReview` is the
// billed-but-unresolved case [B1]; `deposit` drives the DEPOSIT DUE badge.
export function billingBadge(row) {
  if (row.fullyBilled) return { label: 'FULLY BILLED', tone: 'complete' }
  if (row.historyLabel === 'Partially billed') return { label: 'PARTIALLY BILLED', tone: 'partial' }
  if (row.historyLabel === 'Billed') return { label: 'NEEDS REVIEW', tone: 'review' }
  if (row.historyLabel === 'Deposit due') return { label: 'DEPOSIT DUE', tone: 'deposit' }
  return { label: 'NEEDS FINAL BILL', tone: 'ready' } // 'Nothing billed'
}

// terms_override lives on billing_worklist keyed by job_id; the forecast keys by
// invoice.call_log_id — map job_id→call_log_id via jobs so overrides reach invoices.
function buildTermsOverrideMap(jobs, overridesByJobId) {
  const m = new Map()
  for (const job of jobs) {
    const o = overridesByJobId.get(String(job.job_id))
    if (o?.terms_override) m.set(job.call_log_id, o.terms_override)
  }
  return m
}

function groupBy(arr, keyFn) {
  const m = new Map()
  for (const x of arr) {
    const k = keyFn(x)
    if (k == null) continue
    const list = m.get(k)
    if (list) list.push(x)
    else m.set(k, [x])
  }
  return m
}
