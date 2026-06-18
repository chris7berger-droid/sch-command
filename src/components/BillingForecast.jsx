import { useState } from 'react'
import { fmtWk, fmtD } from '../lib/weeks'

// Tab B — 90-Day Cash-Flow Forecast (plan §4). Read-only: renders the buckets
// computed by buildBillingSurface(). The "prize" — nothing else in the suite
// forecasts cash.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()

export default function BillingForecast({ forecast, partial }) {
  // selected bucket for the drill-down: 'pastdue' | a Monday key | null
  const [selected, setSelected] = useState('pastdue')

  if (!forecast) return <div className="bf-empty">No forecast data.</div>

  const { pastDue, weeks, heldRetention } = forecast
  const forwardTotal = weeks.reduce((s, w) => s + w.sum, 0)
  const grand = forwardTotal + pastDue.sum
  const activeWeeks = weeks.filter((w) => w.count > 0)

  const selectedBucket =
    selected === 'pastdue'
      ? { label: 'Past Due', invoices: pastDue.invoices }
      : (() => {
          const w = weeks.find((x) => fmtD(x.monday) === selected)
          return w ? { label: fmtWk(w.monday), invoices: w.invoices } : null
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
        <div className="bf-stat">
          <div className="bf-stat-lbl">Held retention</div>
          <div className="bf-stat-num bf-muted">{money(heldRetention.sum)}</div>
          <div className="bf-stat-sub">{heldRetention.count} invoice{heldRetention.count === 1 ? '' : 's'} · future release</div>
        </div>
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

      {/* drill-down: the collections call list for the selected bucket (§4.4) */}
      {selectedBucket && selectedBucket.invoices.length > 0 && (
        <div className="bf-drill">
          <div className="bf-drill-hdr">{selectedBucket.label} — {selectedBucket.invoices.length} invoice{selectedBucket.invoices.length === 1 ? '' : 's'}</div>
          <table className="bf-table">
            <thead>
              <tr>
                <th>Job</th><th>Sent</th><th>Expected</th><th className="bf-r">Net</th>
              </tr>
            </thead>
            <tbody>
              {selectedBucket.invoices
                .slice()
                .sort((a, b) => (a._expected > b._expected ? 1 : -1))
                .map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv._display_job_number || inv.call_log_id}</td>
                    <td>{inv.sent_at ? String(inv.sent_at).split('T')[0] : '—'}</td>
                    <td>{inv._expected ? fmtD(inv._expected) : '—'}</td>
                    <td className="bf-r">{money(inv._net)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
