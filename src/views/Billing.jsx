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
    setBusyJobId(jobId)
    const { error } = await setBillingWorklistFlag(jobId, field, value, user?.name || 'unknown')
    if (error) {
      toast(`Couldn’t save: ${error.message}`, 'err')
      setBusyJobId(null)
      return
    }
    await loadData()
    setBusyJobId(null)
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
