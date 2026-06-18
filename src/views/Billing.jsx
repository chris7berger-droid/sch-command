import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { loadJobs, loadBillingSurfaceData, setBillingWorklistFlag } from '../lib/queries'
import { buildBillingSurface } from '../lib/billingForecast'
import { getMonday, fmtWk } from '../lib/weeks'
import { useUser } from '../lib/user'
import { useToast } from '../lib/toast'
import BillingWorklist from '../components/BillingWorklist'
import BillingForecast from '../components/BillingForecast'

// /billing — rebuilt as a two-tab surface (plan §7):
//   Tab A = self-populating triage worklist (§3), Tab B = 90-day forecast (§4).
// Reads canonical Sales invoices read-only; writes back only billing_worklist
// override flags. The legacy percent/billing_log 3-column view is retired.

const VALID_TABS = ['worklist', 'forecast']

export default function Billing() {
  const user = useUser()
  const toast = useToast()
  const canEdit = user?.role === 'Admin' // money-config role gate (§8.1c #9)

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab = VALID_TABS.includes(tabParam) ? tabParam : 'worklist'

  const [jobs, setJobs] = useState([])
  const [surface, setSurface] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyJobId, setBusyJobId] = useState(null)

  const setTab = useCallback((next) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('tab', next)
      return p
    })
  }, [setSearchParams])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [jRes, data] = await Promise.all([loadJobs(), loadBillingSurfaceData()])
    setJobs(jRes.data || [])
    setSurface(data)
    setLoading(false)
  }, [])

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
      <div className="bill-tabs">
        <button className={`bill-tab${tab === 'worklist' ? ' on' : ''}`} onClick={() => setTab('worklist')}>
          Billing Worklist
        </button>
        <button className={`bill-tab${tab === 'forecast' ? ' on' : ''}`} onClick={() => setTab('forecast')}>
          90-Day Forecast
        </button>
      </div>

      {loading && <div className="bill-loading">Loading billing…</div>}

      {!loading && built && tab === 'worklist' && (
        <BillingWorklist
          rows={built.rows}
          weekLabel={weekLabel}
          canEdit={canEdit}
          onFlag={onFlag}
          busyJobId={busyJobId}
        />
      )}

      {!loading && built && tab === 'forecast' && (
        <BillingForecast forecast={built.forecast} partial={surface?.partial} />
      )}
    </div>
  )
}
