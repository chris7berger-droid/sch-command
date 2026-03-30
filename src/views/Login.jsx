import { useState, useEffect } from 'react'
import { signIn } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { ScheduleCommandMark } from '../components/Logo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('login')
  const [message, setMessage] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err.message || 'Login failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin
      })
      if (error) throw error
      setMessage('Check your email for a password reset link.')
    } catch (err) {
      setError(err.message || 'Failed to send reset email.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setMessage('Password updated! Redirecting...')
      setTimeout(() => { window.location.href = '/' }, 1500)
    } catch (err) {
      setError(err.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">

        <div className="login-brand">
          <ScheduleCommandMark size={48} />
          <div className="login-title">
            Schedule <span className="login-title-cmd">Command</span>
          </div>
          <div className="login-sub">Command Suite</div>
        </div>

        {message && <div className="login-msg login-msg-ok">{message}</div>}
        {error && <div className="login-msg login-msg-err">{error}</div>}

        {mode === 'login' && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="login-field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <label className="login-remember">
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              Remember me
            </label>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <div className="login-link-row">
              <button type="button" className="login-link" onClick={() => { setMode('forgot'); setError(null); setMessage(null) }}>
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="login-form">
            <div className="login-hint">Enter your email and we'll send you a reset link.</div>
            <div className="login-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <div className="login-link-row">
              <button type="button" className="login-link" onClick={() => { setMode('login'); setError(null); setMessage(null) }}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="login-form">
            <div className="login-hint">Enter your new password.</div>
            <div className="login-field">
              <label>New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
          </form>
        )}

      </div>
    </div>
  )
}
