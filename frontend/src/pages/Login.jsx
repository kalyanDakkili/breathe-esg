import { useState } from 'react'
import { login } from '../api'

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ username: 'analyst', password: 'demo1234' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await login(form.username, form.password)
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      onLogin({ username: form.username })
    } catch {
      setError('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg)',
      backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0,229,160,0.06), transparent)'
    }}>
      <div style={{ width: 360 }}>
        {/* Logo */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '6px 12px', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 6
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)',
              display: 'inline-block'
            }} />
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, letterSpacing: '0.1em', color: 'var(--text-primary)' }}>
              BREATHE ESG
            </span>
          </div>
          <div style={{ marginTop: 24, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            // emissions data ingestion platform
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.05em' }}>
              USERNAME
            </label>
            <input
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              style={inputStyle}
              autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.05em' }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              style={inputStyle}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--rejected)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '10px', background: loading ? 'var(--bg-elevated)' : 'var(--accent)',
              color: loading ? 'var(--text-muted)' : '#0a0c0f', border: 'none', borderRadius: 4,
              fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, letterSpacing: '0.08em',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s'
            }}
          >
            {loading ? 'authenticating…' : 'SIGN IN'}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 4 }}>demo credentials</div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-dim)' }}>analyst / demo1234</div>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px',
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 4, color: 'var(--text-primary)',
  fontSize: 13, fontFamily: 'var(--font-mono)',
  outline: 'none',
  transition: 'border-color 0.15s',
}
