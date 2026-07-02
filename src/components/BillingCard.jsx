import { useState } from 'react'
import { billingBadge } from '../lib/billingForecast'

// Purpose-built billing card (BF-3, Option B) — borrows the StageJobCard design
// language (linen card, colored stage banner, identity bubbles, drill-in tab)
// WITHOUT forking it: none of the scheduling machinery (crew/materials/PRT/the
// SJC-1 day-counter) comes along. Banner = production stage for per-card
// context; banner-right = billing badge; money bubble = CONTRACT/BILLED/
// REMAINING; the BILLING tab holds the manual controls that used to sit inline
// on the old worklist row.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const TERMS_OPTIONS = [15, 30, 45, 60, 75, 90]

// getJobStatus() output → banner class + display label. Reuses the sjc-banner-*
// palette so the billing banner reads identically to the scheduling card.
// KEYS MUST COVER EVERY getJobStatus() output (jobStatus.js): Scheduled /
// In Progress / On Hold / Complete / Ongoing. If a new status is added there,
// resolveStage() below warns in dev instead of silently degrading to ONGOING.
const STAGE_BANNER = {
  'Scheduled':   { cls: 'sjc-banner-ready',    label: 'SCHEDULED' },
  'In Progress': { cls: 'sjc-banner-active',   label: 'ACTIVE' },
  'On Hold':     { cls: 'sjc-banner-on-hold',  label: 'ON HOLD' },
  'Complete':    { cls: 'sjc-banner-complete', label: 'COMPLETE' },
  'Ongoing':     { cls: 'sjc-banner-staged',   label: 'ONGOING' },
}

function resolveStage(productionStage) {
  const mapped = STAGE_BANNER[productionStage]
  if (mapped) return mapped
  if (import.meta.env.DEV) {
    console.warn(`BillingCard: unmapped productionStage "${productionStage}" — add it to STAGE_BANNER (jobStatus.js vocabulary changed?)`)
  }
  return STAGE_BANNER['Ongoing']
}

export default function BillingCard({ row, canEdit, onFlag, busy }) {
  const [showBilling, setShowBilling] = useState(false)
  const o = row.override || {}

  const stage = resolveStage(row.productionStage)
  const badge = billingBadge(row)

  return (
    <div className={`sjc-card bc-card${row.heldSales ? ' bc-held' : ''}${busy ? ' bc-busy' : ''}`}>
      <div className={`sjc-banner ${stage.cls}`}>
        <span className="sjc-banner-stage">{stage.label}</span>
        {row.heldSales && <span className="sjc-banner-reason">held — do not invoice</span>}
        <span className="bc-banner-right">
          {o.nothing_to_bill && <span className="bc-gb-chip" title="Go Back — already built/billed">GB</span>}
          <span className={`bc-badge bc-badge-${badge.tone}`}>{badge.label}</span>
        </span>
      </div>

      <div className="sjc-header" style={{ cursor: 'default' }}>
        <span className="sjc-header-title">
          {row.jobNum}{row.jobName ? ` — ${row.jobName}` : ''}
          {row.isChangeOrder && <span className="bc-co">CO{row.coNumber ? ` ${row.coNumber}` : ''}</span>}
        </span>
      </div>

      <div className="sjc-identity bc-identity-top">
        <div className="sjc-id-bubble">
          <span className="sjc-id-label">Job</span>
          <span className="sjc-id-value bc-id-wrap">{row.jobNum}{row.jobName ? ` — ${row.jobName}` : ''}</span>
        </div>
        <div className="sjc-id-bubble">
          <span className="sjc-id-label">Customer</span>
          <span className="sjc-id-value bc-id-wrap">{row.customerName || '—'}</span>
        </div>
      </div>
      <div className="sjc-identity bc-identity-money">
        <div className="sjc-id-bubble bc-money">
          <span className="sjc-id-label">Contract</span>
          <span className="sjc-id-value bc-mono">{row.authoritativeResolved ? money(row.authoritative) : 'no total'}</span>
        </div>
        <div className="sjc-id-bubble bc-money">
          <span className="sjc-id-label">Billed</span>
          <span className="sjc-id-value bc-mono">{money(row.billed)}</span>
        </div>
        <div className="sjc-id-bubble bc-money">
          <span className="sjc-id-label">Remaining</span>
          <span className="sjc-id-value bc-mono">
            {row.authoritativeResolved && row.remaining != null ? money(row.remaining) : '—'}
          </span>
        </div>
      </div>

      <div className="sjc-toggles">
        <button className={`sjc-toggle${showBilling ? ' open' : ''}`} onClick={() => setShowBilling((v) => !v)}>
          Billing
        </button>
      </div>

      {showBilling && (
        <div className="sjc-panel bc-billing-panel">
          <div className="bc-billing-summary">
            <span>{row.invoiceCount} invoice{row.invoiceCount === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>{row.sentCount} sent</span>
            {row.lastSent && <><span>·</span><span>last sent {row.lastSent}</span></>}
            {row.allPaid && <><span>·</span><span className="bc-paid">paid</span></>}
            {row.ambiguous && <span className="bc-warn">⚠ proposal unresolved</span>}
          </div>

          {canEdit ? (
            <div className="wl-ctrls bc-ctrls">
              <button
                className={`wl-flag${o.hold_sales ? ' on' : ''}`}
                disabled={busy}
                onClick={() => onFlag(row.jobId, 'hold_sales', !o.hold_sales)}
                title="Hold – Sales: do not invoice"
              >Hold</button>
              <button
                className={`wl-flag${o.nothing_to_bill ? ' on' : ''}`}
                disabled={busy}
                onClick={() => onFlag(row.jobId, 'nothing_to_bill', !o.nothing_to_bill)}
                title="Go Back — already built/billed; nothing new to bill (flag it so you know why it came up)"
              >GB</button>
              <select
                className="wl-terms"
                disabled={busy}
                value={o.terms_override || ''}
                onChange={(e) => onFlag(row.jobId, 'terms_override', e.target.value ? Number(e.target.value) : null)}
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
                  if (v !== (o.chris_notes || '')) onFlag(row.jobId, 'chris_notes', v || null)
                }}
              />
            </div>
          ) : (
            <div className="wl-readonly">Read-only — billing flags are Admin-only</div>
          )}
        </div>
      )}
    </div>
  )
}
