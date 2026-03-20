import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [status, setStatus] = useState('Testing connection...')

  useEffect(() => {
    async function test() {
      const { data, error } = await supabase.from('jobs').select('*')
      if (error) {
        setStatus('Connection failed: ' + error.message)
      } else {
        setStatus('Supabase connected! Jobs table has ' + data.length + ' rows.')
      }
    }
    test()
  }, [])

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif' }}>
      <h1>Schedule Commander</h1>
      <p>{status}</p>
    </div>
  )
}

export default App
