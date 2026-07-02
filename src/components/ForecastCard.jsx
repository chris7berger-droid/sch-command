import { useNavigate } from 'react-router-dom'
import { fmtD } from '../lib/weeks'

// Fallback forecast card for an invoice whose job ISN'T in the billing worklist
// (e.g. held retention on a settled job). Borrows the billing card design so it
// reads consistently. When the job resolves in Schedule it clicks in-app to
// /jobs/:jobId (no Sales splash); only a truly Sales-only call_log falls back to
// opening Sales Command in a new tab.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const SALES_HOST = 'https://salescommand.app'

export default function ForecastCard({ inv, moneyLabel = 'Net', jobId = null, jobName = null }) {
  const navigate = useNavigate()
  const jobLabel = inv._display_job_number || jobName || `Call log ${inv.call_log_id}`
  const sent = inv.sent_at ? String(inv.sent_at).split('T')[0] : '—'
  const expected = inv._expected ? fmtD(inv._expected) : '—'

  const open = () => {
    if (jobId != null) navigate(`/jobs/${jobId}`)
    else if (inv.call_log_id) window.open(`${SALES_HOST}/calllog/${inv.call_log_id}`, '_blank', 'noopener')
  }

  return (
    <button className="sjc-card fc-card" onClick={open} title={jobId != null ? 'Open job detail' : 'Open this job in Sales Command (new tab)'}>
      <div className="sjc-banner sjc-banner-staged">
        <span className="sjc-banner-stage">Forecast</span>
        <span className="bc-banner-right">
          <span className="fc-card-open">{jobId != null ? 'Open →' : 'Sales →'}</span>
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
