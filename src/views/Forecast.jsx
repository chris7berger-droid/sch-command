import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadJobs, loadBillingSurfaceData } from '../lib/queries'
import { buildBillingSurface } from '../lib/billingForecast'
import { getMonday } from '../lib/weeks'
import BillingForecast from '../components/BillingForecast'

// /billing/forecast — the 90-Day Cash-Flow Forecast on its OWN screen (Loop #39,
// plan rule #2). Relocated off /billing: the worklist answers "what do I bill",
// the forecast answers "when does cash land" — different questions, own screens.
// Reached from the home-screen "90-Day Forecast" card (JobsPicker).

export default function Forecast() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [surface, setSurface] = useState(null)
  const [loading, setLoading] = useState(true)
  const loadIdRef = useRef(0)

  const loadData = useCallback(async () => {
    const thisLoad = ++loadIdRef.current
    setLoading(true)
    const [jRes, data] = await Promise.all([loadJobs(), loadBillingSurfaceData()])
    if (thisLoad !== loadIdRef.current) return
    setJobs(jRes.data || [])
    setSurface(data)
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const built = useMemo(() => {
    if (!surface) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return buildBillingSurface(jobs, surface, today, getMonday)
  }, [jobs, surface])

  return (
    <div className="bill-surface">
      <div className="fc-header">
        <button className="bill-drill-back" onClick={() => navigate('/jobs')}>&larr; All jobs</button>
        <span className="bill-drill-title">90-Day Forecast</span>
      </div>

      {loading && <div className="bill-loading">Loading forecast…</div>}
      {!loading && built && (
        <BillingForecast forecast={built.forecast} partial={surface?.partial} />
      )}
    </div>
  )
}
