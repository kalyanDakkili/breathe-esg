import { BarChart3, Upload, Database, List, LogOut, Leaf } from 'lucide-react'

const NAV = [
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'records',  icon: List,      label: 'Records' },
  { id: 'upload',   icon: Upload,    label: 'Ingest Data' },
  { id: 'batches',  icon: Database,  label: 'Batches' },
]

export default function Sidebar({ activeTab, setActiveTab, clients, selectedClient, setSelectedClient, user, onLogout, summary }) {
  const pending = summary?.status_counts?.pending || 0
  const flagged = summary?.status_counts?.flagged || 0

  return (
    <aside style={{
      width: 220, background: 'var(--bg-card)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: 'var(--accent-glow)',
            border: '1px solid rgba(0,229,160,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Leaf size={14} color="var(--accent)" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)' }}>BREATHE</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: -1 }}>ESG Platform</div>
          </div>
        </div>
      </div>

      {/* Client selector */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.05em' }}>CLIENT</div>
        <select
          value={selectedClient?.slug || ''}
          onChange={e => setSelectedClient(clients.find(c => c.slug === e.target.value))}
          style={{
            width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 4, padding: '5px 8px',
            fontSize: 12, outline: 'none',
          }}
        >
          {clients.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>

      {/* Nav */}
      <nav style={{ padding: '8px 8px', flex: 1 }}>
        {NAV.map(({ id, icon: Icon, label }) => {
          const active = activeTab === id
          const badge = id === 'records' && flagged > 0 ? flagged : null
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 5, marginBottom: 2,
                background: active ? 'var(--accent-glow)' : 'transparent',
                border: active ? '1px solid rgba(0,229,160,0.15)' : '1px solid transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: active ? 600 : 400,
                transition: 'all 0.12s', cursor: 'pointer',
              }}
            >
              <Icon size={15} />
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
              {badge && (
                <span style={{
                  background: 'rgba(245,158,11,0.15)', color: 'var(--flagged)',
                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3,
                  border: '1px solid rgba(245,158,11,0.2)'
                }}>{badge}</span>
              )}
              {id === 'records' && pending > 0 && !badge && (
                <span style={{
                  background: 'rgba(100,116,139,0.15)', color: 'var(--pending)',
                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3,
                  border: '1px solid rgba(100,116,139,0.2)'
                }}>{pending}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* User */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)'
          }}>
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, fontFamily: 'var(--font-mono)' }}>
            {user?.username}
          </span>
          <button
            onClick={onLogout}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  )
}
