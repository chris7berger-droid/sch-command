import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './lib/toast'
import { SyncProvider } from './lib/sync'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SyncProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SyncProvider>
    </BrowserRouter>
  </StrictMode>,
)
