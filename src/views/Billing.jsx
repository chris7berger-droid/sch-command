import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { loadJobs, loadBillingSurfaceData, setBillingWorklistFlag } from '../lib/queries'
import { buildBillingSurface } from '../lib/billingForecast'
import { getMonday, fmtWk } from '../lib/weeks'
import { useUser } from '../lib/user'
import { useToast } from '../lib/toast'
import BillingPicker from '../components/BillingPicker'

// /billing — the billing worklist as a 4-card billing-state picker (BF-3).
// Reads canonical Sales invoices read-only; writes back only billing_worklist
// override flags. The 90-Day Forecast relocated to its own screen
// (/billing/forecast, Loop #39 rule #2) — no tab shell here anymore.

export default function Billing() {
  const user = useUser()
  const toast = useToast()
  const canEdit = user?.role === 'Admin' // money-config role gate (§8.1c #9)

  const [jobs, setJobs] = useState([])
  const [surface, setSurface] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyJobId, setBusyJobId] = useState(null)
  const loadIdRef = useRef(0)

  const loadData = useCallback(async () => {
    const thisLoad = ++loadIdRef.current
    setLoading(true)
    const [jRes, data] = await Promise.all([loadJobs(), loadBillingSurfaceData()])
    if (thisLoad !== loadIdRef.current) return // a newer load superseded this one
    setJobs(jRes.data || [])
    setSurface(data)
    setLoading(false)
  }, [])

  // Mount data-load (same idiom as Jobs.jsx loadData). The set-state-in-effect
  // rule false-positives on this short loadData but not Jobs.jsx's longer one;
  // the loadIdRef guard already prevents the cascading-render concern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const built = useMemo(() => {
    if (!surface) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return buildBillingSurface(jobs, surface, today, getMonday)
  }, [jobs, surface])

  const weekLabel = useMemo(() => fmtWk(getMonday(new Date())), [])

  const onFlag = useCallback(async (jobId, field, value) => {
    if (!canEdit) return
    // Optimistic: patch the local override immediately so the card updates in
    // place (no full reload, no loading flicker, drill-in stays put). buildBilling
    // Surface re-derives from surface.overrides via useMemo, so the GB chip /
    // status flip is instant. Persist in the background; revert on failure.
    setBusyJobId(jobId)
    setSurface((prev) => {
      if (!prev) return prev
      const overrides = prev.overrides ? [...prev.overrides] : []
      const idx = overrides.findIndex((o) => String(o.job_id) === String(jobId))
      if (idx >= 0) overrides[idx] = { ...overrides[idx], [field]: value }
      else overrides.push({ job_id: jobId, [field]: value })
      return { ...prev, overrides }
    })
    const { error } = await setBillingWorklistFlag(jobId, field, value, user?.name || 'unknown')
    setBusyJobId(null)
    if (error) {
      toast(`Couldn’t save: ${error.message}`, 'err')
      await loadData() // revert to server truth
      return
    }
    toast('Saved', 'ok')
  }, [canEdit, user, toast, loadData])

  return (
    <div className="bill-surface">
      {loading && <div className="bill-loading">Loading billing…</div>}

      {!loading && built && (
        <BillingPicker
          rows={built.rows}
          weekLabel={weekLabel}
          canEdit={canEdit}
          onFlag={onFlag}
          busyJobId={busyJobId}
        />
      )}
    </div>
  )
}
