import { fmtD } from '../lib/weeks'

// One forecast invoice as a card in the billing design language (BF-6). Used by
// the 90-Day Forecast drill-ins (past-due / weekly / held-retention). The whole
// card is clickable → opens the job in Sales Command in a new tab (BF-5): Schedule
// has no invoice/proposal detail, Sales does. Every forecast row carries call_log_id.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()

// Sales Command production host (Command Suite). Confirm before prod if this moves.
const SALES_HOST = 'https://salescommand.app'

export default function ForecastCard({ inv, moneyLabel = 'Net' }) {
  const jobLabel = inv._display_job_number || `Call log ${inv.call_log_id}`
  const sent = inv.sent_at ? String(inv.sent_at).split('T')[0] : '—'
  const expected = inv._expected ? fmtD(inv._expected) : '—'

  const openInSales = () => {
    if (inv.call_log_id) window.open(`${SALES_HOST}/calllog/${inv.call_log_id}`, '_blank', 'noopener')
  }

  return (
    <button className="sjc-card fc-card" onClick={openInSales} title="Open this job in Sales Command (new tab)">
      <div className="sjc-header">
        <span className="sjc-header-title">{jobLabel}</span>
        <span className="fc-card-open">Sales &rarr;</span>
      </div>
      <div className="sjc-identity fc-card-bubbles">
        <div className="sjc-id-bubble bc-money">
          <span className="sjc-id-label">Sent</span>
          <span className="sjc-id-value bc-mono">{sent}</span>
        </div>
        <div className="sjc-id-bubble bc-money">
          <span className="sjc-id-label">Expected</span>
          <span className="sjc-id-value bc-mono">{expected}</span>
        </div>
        <div className="sjc-id-bubble bc-money">
          <span className="sjc-id-label">{moneyLabel}</span>
          <span className="sjc-id-value bc-mono">{money(inv._net)}</span>
        </div>
      </div>
    </button>
  )
}
