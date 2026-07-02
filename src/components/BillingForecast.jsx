import { useState, useMemo } from 'react'
import { fmtWk, fmtD } from '../lib/weeks'
import ForecastCard from './ForecastCard'
import BillingCard from './BillingCard'

// Tab B — 90-Day Cash-Flow Forecast (plan §4). Read-only: renders the buckets
// computed by buildBillingSurface(). The "prize" — nothing else in the suite
// forecasts cash. Drill-ins reuse the full billing card (via the job's worklist
// row, looked up by call_log_id) so the forecast reads in the standard format;
// an invoice whose job isn't in the worklist falls back to a light ForecastCard.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()

export default function BillingForecast({ forecast, partial, rows = [] }) {
  const rowByCallLog = useMemo(() => {
    const m = new Map()
    for (const r of rows) m.set(r.callLogId, r)
    return m
  }, [rows])

  // selected bucket for the drill-down: 'pastdue' | a Monday key | null
  const [selected, setSelected] = useState('pastdue')

  if (!forecast) return <div className="bf-empty">No forecast data.</div>

  const { pastDue, weeks, heldRetention } = forecast
  const forwardTotal = weeks.reduce((s, w) => s + w.sum, 0)
  const grand = forwardTotal + pastDue.sum
  const activeWeeks = weeks.filter((w) => w.count > 0)

  const selectedBucket =
    selected === 'pastdue'
      ? { label: 'Past Due', invoices: pastDue.invoices, moneyLabel: 'Net' }
      : selected === 'retention'
      ? { label: 'Held Retention', invoices: heldRetention.invoices, moneyLabel: 'Retention' }
      : (() => {
          const w = weeks.find((x) => fmtD(x.monday) === selected)
          return w ? { label: fmtWk(w.monday), invoices: w.invoices, moneyLabel: 'Net' } : null
        })()

  return (
    <div className="bf">
      {partial && (
        <div className="bf-warn">⚠ Some invoice pages didn’t load — totals may be stale. Reload.</div>
      )}

      {/* summary band */}
      <div className="bf-summary">
        <div className="bf-stat bf-stat-grand">
          <div className="bf-stat-lbl">Expected inflow · next 90 days</div>
          <div className="bf-stat-num">{money(grand)}</div>
          <div className="bf-stat-sub">{money(pastDue.sum)} past due + {money(forwardTotal)} upcoming</div>
        </div>
        {heldRetention.count > 0 ? (
          <button
            className={`bf-stat bf-stat-btn${selected === 'retention' ? ' on' : ''}`}
            onClick={() => setSelected('retention')}
            title="Show the jobs holding retention"
          >
            <div className="bf-stat-lbl">Held retention <span className="bf-stat-hint">view jobs &rarr;</span></div>
            <div className="bf-stat-num bf-muted">{money(heldRetention.sum)}</div>
            <div className="bf-stat-sub">{heldRetention.count} invoice{heldRetention.count === 1 ? '' : 's'} · future release</div>
          </button>
        ) : (
          <div className="bf-stat">
            <div className="bf-stat-lbl">Held retention</div>
            <div className="bf-stat-num bf-muted">{money(heldRetention.sum)}</div>
            <div className="bf-stat-sub">0 invoices · future release</div>
          </div>
        )}
      </div>

      {/* buckets */}
      <div className="bf-buckets">
        {pastDue.count > 0 && (
          <button
            className={`bf-bucket bf-bucket-pastdue${selected === 'pastdue' ? ' on' : ''}`}
            onClick={() => setSelected('pastdue')}
          >
            <div className="bf-bucket-wk">Past Due</div>
            <div className="bf-bucket-amt">{money(pastDue.sum)}</div>
            <div className="bf-bucket-cnt">{pastDue.count} overdue</div>
          </button>
        )}
        {activeWeeks.map((w) => {
          const key = fmtD(w.monday)
          return (
            <button
              key={key}
              className={`bf-bucket${selected === key ? ' on' : ''}`}
              onClick={() => setSelected(key)}
            >
              <div className="bf-bucket-wk">{fmtWk(w.monday)}</div>
              <div className="bf-bucket-amt">{money(w.sum)}</div>
              <div className="bf-bucket-cnt">{w.count} invoice{w.count === 1 ? '' : 's'}</div>
            </button>
          )
        })}
        {activeWeeks.length === 0 && pastDue.count === 0 && (
          <div className="bf-empty">No sent-and-unpaid invoices in the next 90 days.</div>
        )}
      </div>

      {/* past-due gross-of-partials caveat (ADJ-6 / N6) */}
      {selected === 'pastdue' && pastDue.count > 0 && (
        <div className="bf-note">
          Past-due total is <strong>gross of any partial payments</strong> — the DB tracks no partial-payment
          amount, so an invoice paid partly outside the system still shows its full net here.
        </div>
      )}

      {/* drill-down: the collections call list for the selected bucket (§4.4).
          Each job renders as the full billing card (looked up by call_log_id,
          deduped by job) so the format matches the worklist; invoices whose job
          isn't in the worklist fall back to a light ForecastCard. */}
      {selectedBucket && selectedBucket.invoices.length > 0 && (() => {
        const sorted = selectedBucket.invoices.slice().sort((a, b) => {
          if (!a._expected && !b._expected) return 0
          if (!a._expected) return 1
          if (!b._expected) return -1
          return a._expected > b._expected ? 1 : -1
        })
        const seenJobs = new Set()
        const jobCards = []
        const orphanInvoices = []
        for (const inv of sorted) {
          const row = rowByCallLog.get(inv.call_log_id)
          if (row) {
            if (!seenJobs.has(row.jobId)) { seenJobs.add(row.jobId); jobCards.push(row) }
          } else {
            orphanInvoices.push(inv)
          }
        }
        return (
          <div className="bf-drill">
            <div className="bf-drill-hdr">
              {selectedBucket.label} — {jobCards.length} job{jobCards.length === 1 ? '' : 's'} · {selectedBucket.invoices.length} invoice{selectedBucket.invoices.length === 1 ? '' : 's'}
            </div>
            <div className="bill-drill-grid">
              {jobCards.map((row) => (
                <BillingCard key={row.jobId} row={row} canEdit={false} onFlag={() => {}} busy={false} />
              ))}
              {orphanInvoices.map((inv) => (
                <ForecastCard key={inv.id} inv={inv} moneyLabel={selectedBucket.moneyLabel} />
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
