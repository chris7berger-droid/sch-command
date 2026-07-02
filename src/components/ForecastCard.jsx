import { fmtD } from '../lib/weeks'

// Fallback forecast card for an invoice whose job ISN'T in the billing worklist
// (e.g. held retention on a settled job, or a Sales-side change order). Borrows
// the billing card design so it reads consistently. Like the full billing card,
// clicking opens the job's record in Sales Command (proposals + invoices live
// there) — same destination for every card.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const SALES_HOST = 'https://salescommand.app'

export default function ForecastCard({ inv, moneyLabel = 'Net', jobName = null }) {
  const jobLabel = inv._display_job_number || jobName || `Call log ${inv.call_log_id}`
  const sent = inv.sent_at ? String(inv.sent_at).split('T')[0] : '—'
  const expected = inv._expected ? fmtD(inv._expected) : '—'

  const openInSales = () => {
    if (inv.call_log_id) window.open(`${SALES_HOST}/calllog/${inv.call_log_id}`, '_blank', 'noopener')
  }

  return (
    <button className="sjc-card fc-card" onClick={openInSales} title="Open this job in Sales Command (proposals + invoices)">
      <div className="sjc-banner sjc-banner-staged">
        <span className="sjc-banner-stage">Forecast</span>
        <span className="bc-banner-right">
          <span className="fc-card-open">Sales →</span>
        </span>
      </div>
      <div className="sjc-header">
        <span className="sjc-header-title">{jobLabel}</span>
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
