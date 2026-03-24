import { createContext, useContext, useState, useCallback } from 'react'

const SyncContext = createContext()

export function SyncProvider({ children }) {
  const [syncState, setSyncState] = useState('ok') // 'ok' | 'ing' | 'bad'

  const setSync = useCallback((state) => {
    setSyncState(state)
  }, [])

  return (
    <SyncContext.Provider value={{ syncState, setSync }}>
      {children}
    </SyncContext.Provider>
  )
}

export function useSync() {
  return useContext(SyncContext)
}
