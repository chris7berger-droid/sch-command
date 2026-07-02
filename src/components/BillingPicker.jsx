import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BILLING_CARDS, billingCardKey } from '../lib/billingForecast'
import BillingCard from './BillingCard'

// BF-3 — the billing screen as a 4-card picker BY BILLING STATE (Ready to Bill /
// Partially Billed / Billed Complete / Pay Apps), mirroring the home-screen
// JobsPicker card style. Pick a card → drill into just those jobs, rendered as
// purpose-built billing cards. "3 simple screens beats 1 busy screen."

const money = (n) => '$' + Math.round(n || 0).toLocaleString()

export default function BillingPicker({ rows, weekLabel, canEdit, onFlag, busyJobId }) {
  const [selected, setSelected] = useState(null)
  const navigate = useNavigate()

  const byCard = useMemo(() => {
    const groups = { ready: [], partial: [], complete: [], payApps: [] }
    for (const r of rows) groups[billingCardKey(r)].push(r)
    return groups
  }, [rows])

  // TOTAL TO BILL = remaining authoritative balance across everything still
  // owed (any card that isn't fully billed). At-a-glance $ stays on top.
  const toBill = useMemo(
    () => rows.filter((r) => !r.fullyBilled).reduce((s, r) => s + (r.remaining || 0), 0),
    [rows],
  )

  // The jobs that sum into TOTAL TO BILL — everything still owed. Its own drill-in
  // (pseudo-card 'toBill') reached by clicking the total, rendered as billing cards.
  const toBillRows = useMemo(() => rows.filter((r) => !r.fullyBilled), [rows])

  // Go Backs — jobs flagged GB (already built/billed, nothing new to bill). A
  // cross-cutting filter + count so Chris can see why a job came up and track how
  // many go-backs there are. (Underlying flag is still billing_worklist.nothing_to_bill.)
  const goBackRows = useMemo(() => rows.filter((r) => r.override?.nothing_to_bill), [rows])

  const selectedDef = selected === 'toBill'
    ? { label: 'Total to Bill' }
    : selected === 'goBacks'
    ? { label: 'Go Backs' }
    : selected ? BILLING_CARDS.find((c) => c.key === selected) : null
  const selectedRows = selected === 'toBill' ? toBillRows
    : selected === 'goBacks' ? goBackRows
    : selected ? byCard[selected] : []

  return (
    <div className="jh-picker bill-picker">
      <div className="fc-header">
        <button className="bill-drill-back" onClick={() => navigate('/jobs')}>&larr; All jobs</button>
        <span className="bill-drill-title">Billing</span>
      </div>

      <button
        className={`bill-picker-summary bill-picker-summary-btn${selected === 'toBill' ? ' on' : ''}`}
        onClick={() => setSelected('toBill')}
        title="Show the jobs that make up this total"
      >
        <div className="bill-picker-sum-lbl">Total to bill — {weekLabel} <span className="bill-picker-sum-hint">view jobs &rarr;</span></div>
        <div className="bill-picker-sum-num">{money(toBill)}</div>
        <div className="bill-picker-sum-sub">{toBillRows.length} still owed · {rows.length} on the billing list</div>
      </button>

      <button
        className={`bill-gb-filter${selected === 'goBacks' ? ' on' : ''}`}
        onClick={() => setSelected('goBacks')}
        title="Go Backs — jobs already built/billed, flagged so you know why they came up"
      >
        <span className="bill-gb-icon">&#8617;</span>
        <span className="bill-gb-count">{goBackRows.length}</span>
        Go Back{goBackRows.length === 1 ? '' : 's'}
        <span className="bill-gb-hint">view &rarr;</span>
      </button>

      {!selected && (
        <div className="jh-picker-grid">
          {BILLING_CARDS.map((c) => (
            <button
              key={c.key}
              className={`jh-tile bill-tile bill-tile-${c.tone}`}
              onClick={() => setSelected(c.key)}
            >
              <div className="jh-tile-head">
                <div className="jh-tile-name"><span className="jh-tile-dot" />{c.label}</div>
                <div className="jh-tile-count">{byCard[c.key].length}</div>
              </div>
              <div className="jh-tile-desc">{c.desc}</div>
              <div className="jh-tile-foot">
                <span className="jh-tile-attn">{byCard[c.key].length} job{byCard[c.key].length === 1 ? '' : 's'}</span>
                <span className="jh-tile-arrow">&rarr;</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bill-drill">
          <div className="bill-drill-hdr">
            <button className="bill-drill-back" onClick={() => setSelected(null)}>&larr; All billing cards</button>
            <span className="bill-drill-title">{selectedDef.label}</span>
            <span className="bill-drill-count">{selectedRows.length}</span>
          </div>

          {selectedRows.length === 0 ? (
            <div className="bill-drill-empty">Nothing in this card right now.</div>
          ) : (
            <div className="bill-drill-grid">
              {selectedRows.map((r) => (
                <BillingCard
                  key={r.jobId}
                  row={r}
                  canEdit={canEdit}
                  onFlag={onFlag}
                  busy={busyJobId === r.jobId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
