import { WL_STATUS } from '../lib/billingForecast'

// Tab A — Weekly Billing Triage Worklist (plan §3). Self-populating from the
// hybrid trigger (§8.1c); auto statuses + manual overrides. Manual write
// controls are Admin-gated (§8.1c #9); Sales Reps see read-only.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()

// display order: actionable first, terminal (All Ready Billed) last
const STATUS_ORDER = [
  WL_STATUS.NEEDS_TRIAGE,
  WL_STATUS.SENT,
  WL_STATUS.SENT_TO_QB,
  WL_STATUS.HOLD_SALES,
  WL_STATUS.NOTHING_TO_BILL,
  WL_STATUS.ALL_READY_BILLED,
]
const STATUS_CLASS = {
  [WL_STATUS.NEEDS_TRIAGE]: 'wl-st-triage',
  [WL_STATUS.SENT]: 'wl-st-sent',
  [WL_STATUS.SENT_TO_QB]: 'wl-st-qb',
  [WL_STATUS.HOLD_SALES]: 'wl-st-hold',
  [WL_STATUS.NOTHING_TO_BILL]: 'wl-st-nothing',
  [WL_STATUS.ALL_READY_BILLED]: 'wl-st-done',
}
const TERMS_OPTIONS = [15, 30, 45, 60, 75, 90]

export default function BillingWorklist({ rows, weekLabel, canEdit, onFlag, busyJobId }) {
  // "Total to bill this week" = remaining authoritative balance over actionable rows
  const actionable = rows.filter((r) => r.status === WL_STATUS.NEEDS_TRIAGE)
  const toBill = actionable.reduce((s, r) => s + (r.remaining || 0), 0)

  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: rows.filter((r) => r.status === status),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="wl">
      <div className="wl-summary">
        <div>
          <div className="wl-sum-lbl">Total to bill — {weekLabel}</div>
          <div className="wl-sum-num">{money(toBill)}</div>
          <div className="wl-sum-sub">{actionable.length} job{actionable.length === 1 ? '' : 's'} need triage · {rows.length} on the list</div>
        </div>
        {!canEdit && <div className="wl-readonly">Read-only — billing flags are Admin-only</div>}
      </div>

      {rows.length === 0 && <div className="wl-empty">Nothing to bill this week. 🎉</div>}

      {groups.map((g) => (
        <div key={g.status} className="wl-group">
          <div className={`wl-group-hdr ${STATUS_CLASS[g.status]}`}>
            {g.status} <span className="wl-group-cnt">{g.rows.length}</span>
          </div>
          {g.rows.map((r) => (
            <WorklistRow key={`${r.jobId}`} r={r} canEdit={canEdit} onFlag={onFlag} busy={busyJobId === r.jobId} />
          ))}
        </div>
      ))}
    </div>
  )
}

function WorklistRow({ r, canEdit, onFlag, busy }) {
  const o = r.override || {}
  return (
    <div className={`wl-row${busy ? ' wl-busy' : ''}`}>
      <div className="wl-main">
        <div className="wl-name">
          {r.jobNum}{r.jobName ? ` — ${r.jobName}` : ''}
          {r.isChangeOrder && <span className="wl-co">CO{r.coNumber ? ` ${r.coNumber}` : ''}</span>}
        </div>
        <div className="wl-meta">
          {r.customerName && <span>{r.customerName}</span>}
          <span className={`wl-hist`}>{r.historyLabel}</span>
          {r.arm === 'deposit' && <span className="wl-arm wl-arm-dep">deposit trigger</span>}
          {r.arm === 'production' && <span className="wl-arm wl-arm-prod">production trigger</span>}
          {r.ambiguous && <span className="wl-warn">⚠ proposal unresolved</span>}
        </div>
      </div>

      <div className="wl-amts">
        {r.authoritativeResolved ? (
          <>
            <div className="wl-amt-main">{money(r.billed)} <span className="wl-amt-of">/ {money(r.authoritative)}</span></div>
            {r.remaining > 0 && <div className="wl-amt-rem">{money(r.remaining)} left</div>}
            {r.fullyBilled && r.allPaid && <div className="wl-amt-paid">paid</div>}
          </>
        ) : (
          <div className="wl-amt-unres">no contract total</div>
        )}
      </div>

      {canEdit && (
        <div className="wl-ctrls">
          <button
            className={`wl-flag${o.hold_sales ? ' on' : ''}`}
            disabled={busy}
            onClick={() => onFlag(r.jobId, 'hold_sales', !o.hold_sales)}
            title="Hold – Sales: do not invoice"
          >Hold</button>
          <button
            className={`wl-flag${o.nothing_to_bill ? ' on' : ''}`}
            disabled={busy}
            onClick={() => onFlag(r.jobId, 'nothing_to_bill', !o.nothing_to_bill)}
            title="Nothing to bill this week"
          >N/B</button>
          <select
            className="wl-terms"
            disabled={busy}
            value={o.terms_override || ''}
            onChange={(e) => onFlag(r.jobId, 'terms_override', e.target.value ? Number(e.target.value) : null)}
            title="Per-job payment terms override"
          >
            <option value="">terms</option>
            {TERMS_OPTIONS.map((t) => <option key={t} value={t}>net {t}</option>)}
          </select>
          <input
            className="wl-notes"
            defaultValue={o.chris_notes || ''}
            disabled={busy}
            placeholder="notes"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== (o.chris_notes || '')) onFlag(r.jobId, 'chris_notes', v || null)
            }}
          />
        </div>
      )}
    </div>
  )
}
