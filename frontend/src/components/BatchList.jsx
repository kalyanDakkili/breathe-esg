import { useState, useEffect } from 'react'
import { getBatches } from '../api'
import { RefreshCw } from 'lucide-react'

const SOURCE_COLORS = { sap: '#f97316', utility: '#3b82f6', travel: '#a855f7' }
const STATUS_META = {
  done: { label: 'Done', color: 'var(--approved)' },
  failed: { label: 'Failed', color: 'var(--rejected)' },
  processing: { label: 'Processing', color: 'var(--flagged)' },
  pending: { label: 'Pending', color: 'var(--pending)' },
}

export default function BatchList({ client }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!client) return
    setLoading(true)
    try {
      const r = await getBatches(client.slug)
      setBatches(r.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [client])

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>INGESTION BATCHES</div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Upload History</h2>
        </div>
        <button onClick={load} style={{ padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              {['Source Type', 'Filename', 'Uploaded By', 'Uploaded At', 'Rows', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Loading…</td></tr>
            )}
            {!loading && batches.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No batches yet — upload a file to begin</td></tr>
            )}
            {batches.map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 3,
                    fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: SOURCE_COLORS[b.source_type],
                    background: `rgba(${b.source_type === 'sap' ? '249,115,22' : b.source_type === 'utility' ? '59,130,246' : '168,85,247'},0.1)`,
                    border: `1px solid rgba(${b.source_type === 'sap' ? '249,115,22' : b.source_type === 'utility' ? '59,130,246' : '168,85,247'},0.2)`,
                  }}>
                    {b.source_type_display}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 220 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {b.filename || '—'}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {b.uploaded_by}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(b.uploaded_at).toLocaleString()}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{b.rows_parsed}<span style={{ color: 'var(--text-muted)' }}>/{b.rows_total}</span></span>
                    {b.rows_flagged > 0 && <span style={{ color: 'var(--flagged)' }}>⚑ {b.rows_flagged}</span>}
                    {b.rows_failed > 0 && <span style={{ color: 'var(--rejected)' }}>✗ {b.rows_failed}</span>}
                  </div>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 3,
                    color: STATUS_META[b.status]?.color || 'var(--text-muted)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    {STATUS_META[b.status]?.label || b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
