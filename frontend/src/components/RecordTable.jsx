import { useState, useEffect, useCallback } from 'react'
import { getRecords, patchRecord, bulkAction, getRecord } from '../api'
import { AlertTriangle, Check, X, ChevronLeft, ChevronRight, Flag, Eye, RefreshCw } from 'lucide-react'

const STATUS_META = {
  pending:  { label: 'Pending',  cls: 'badge-pending' },
  flagged:  { label: 'Flagged',  cls: 'badge-flagged' },
  approved: { label: 'Approved', cls: 'badge-approved' },
  rejected: { label: 'Rejected', cls: 'badge-rejected' },
}

const SCOPE_COLORS = { 1: '#f97316', 2: '#3b82f6', 3: '#a855f7' }

function formatCO2e(val) {
  if (!val) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const n = parseFloat(val)
  return <span style={{ fontFamily: 'var(--font-mono)' }}>{n.toFixed(2)}</span>
}

export default function RecordTable({ client }) {
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState({})
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filters, setFilters] = useState({ status: '', scope: '' })
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailData, setDetailData] = useState(null)

  const load = useCallback(async () => {
    if (!client) return
    setLoading(true)
    try {
      const params = { client_slug: client.slug, page, ...filters }
      if (!params.status) delete params.status
      if (!params.scope) delete params.scope
      const r = await getRecords(params)
      setRecords(r.data.results)
      setSummary(r.data.summary)
      setTotalPages(r.data.total_pages)
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [client, page, filters])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filters, client])

  async function handleAction(id, action) {
    await patchRecord(id, { action })
    load()
  }

  async function handleBulk(action) {
    if (selected.size === 0) return
    await bulkAction({ record_ids: Array.from(selected), action })
    load()
  }

  async function openDetail(id) {
    setDetail(id)
    const r = await getRecord(id)
    setDetailData(r.data)
  }

  const allSelected = records.length > 0 && records.every(r => selected.has(r.id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(records.map(r => r.id)))
  }

  function toggleOne(id) {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  return (
    <div style={{ padding: 28, maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>
            EMISSION RECORDS
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {summary.total || 0} total · {summary.flagged || 0} flagged · {summary.pending || 0} pending
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginRight: 4 }}>
                {selected.size} selected
              </span>
              <Btn onClick={() => handleBulk('approved')} color="var(--approved)" icon={<Check size={12} />}>Approve All</Btn>
              <Btn onClick={() => handleBulk('rejected')} color="var(--rejected)" icon={<X size={12} />}>Reject All</Btn>
              <Btn onClick={() => handleBulk('flagged')} color="var(--flagged)" icon={<Flag size={12} />}>Flag All</Btn>
            </>
          )}
          <button onClick={load} style={{ padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <FilterBtn active={!filters.status} onClick={() => setFilters(f => ({ ...f, status: '' }))}>All</FilterBtn>
        {['pending','flagged','approved','rejected'].map(s => (
          <FilterBtn key={s} active={filters.status === s} onClick={() => setFilters(f => ({ ...f, status: s }))}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s === 'flagged' && summary.flagged > 0 && (
              <span style={{ marginLeft: 4, background: 'rgba(245,158,11,0.2)', padding: '0 4px', borderRadius: 2, fontSize: 10 }}>
                {summary.flagged}
              </span>
            )}
          </FilterBtn>
        ))}
        <div style={{ marginLeft: 8, display: 'flex', gap: 6 }}>
          {[1,2,3].map(s => (
            <FilterBtn key={s} active={filters.scope === String(s)} onClick={() => setFilters(f => ({ ...f, scope: filters.scope === String(s) ? '' : String(s) }))} scopeColor={SCOPE_COLORS[s]}>
              Scope {s}
            </FilterBtn>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              <Th><input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} /></Th>
              <Th>Date</Th>
              <Th>Source</Th>
              <Th>Scope</Th>
              <Th>Location / Detail</Th>
              <Th>Quantity</Th>
              <Th>kg CO2e</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Loading…</td></tr>
            )}
            {!loading && records.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No records match the current filter</td></tr>
            )}
            {records.map(r => (
              <tr key={r.id} style={{
                borderBottom: '1px solid var(--border-subtle)',
                background: selected.has(r.id) ? 'rgba(0,229,160,0.03)' : 'transparent',
                opacity: r.status === 'rejected' ? 0.5 : 1,
              }}>
                <Td>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} style={{ cursor: 'pointer' }} />
                </Td>
                <Td mono>{r.activity_date}</Td>
                <Td>
                  <span style={{ fontSize: 10, background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 3, color: 'var(--text-secondary)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)' }}>
                    {r.category.replace('_', ' ')}
                  </span>
                </Td>
                <Td>
                  <span style={{ color: SCOPE_COLORS[r.scope], fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
                    S{r.scope}
                  </span>
                </Td>
                <Td>
                  <div style={{ maxWidth: 200 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.location || r.travel_origin && r.travel_destination ? `${r.travel_origin} → ${r.travel_destination}` : r.employee_id || '—'}
                    </div>
                    {r.flag_reason && (
                      <div style={{ fontSize: 10, color: 'var(--flagged)', marginTop: 2, display: 'flex', gap: 3, alignItems: 'center' }}>
                        <AlertTriangle size={9} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                          {r.flag_reason}
                        </span>
                      </div>
                    )}
                  </div>
                </Td>
                <Td mono>{r.source_quantity} {r.source_unit}</Td>
                <Td>{formatCO2e(r.quantity_kg_co2e)}</Td>
                <Td>
                  <span className={`badge ${STATUS_META[r.status]?.cls}`}>
                    {STATUS_META[r.status]?.label}
                  </span>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <ActionBtn onClick={() => openDetail(r.id)} title="View detail" color="var(--text-muted)">
                      <Eye size={12} />
                    </ActionBtn>
                    {r.status !== 'approved' && (
                      <ActionBtn onClick={() => handleAction(r.id, 'approved')} title="Approve" color="var(--approved)">
                        <Check size={12} />
                      </ActionBtn>
                    )}
                    {r.status !== 'rejected' && (
                      <ActionBtn onClick={() => handleAction(r.id, 'rejected')} title="Reject" color="var(--rejected)">
                        <X size={12} />
                      </ActionBtn>
                    )}
                    {r.status !== 'flagged' && (
                      <ActionBtn onClick={() => handleAction(r.id, 'flagged')} title="Flag for review" color="var(--flagged)">
                        <Flag size={12} />
                      </ActionBtn>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          Page {page} of {totalPages}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={paginBtnStyle}>
            <ChevronLeft size={13} />
          </button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={paginBtnStyle}>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Detail modal */}
      {detail && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100, backdropFilter: 'blur(4px)'
        }} onClick={() => { setDetail(null); setDetailData(null) }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            width: 560, maxHeight: '80vh', overflow: 'auto', padding: 24
          }} onClick={e => e.stopPropagation()}>
            {!detailData ? (
              <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 20, textAlign: 'center' }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{detailData.category_display}</div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>{detailData.id.slice(0, 8)}…</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={`badge ${STATUS_META[detailData.status]?.cls}`}>{STATUS_META[detailData.status]?.label}</span>
                    <button onClick={() => { setDetail(null); setDetailData(null) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <DetailSection title="Emission Data">
                  <DetailRow k="Activity Date" v={detailData.activity_date} />
                  {detailData.period_start && <DetailRow k="Billing Period" v={`${detailData.period_start} → ${detailData.period_end}`} />}
                  <DetailRow k="Location" v={detailData.location || '—'} />
                  <DetailRow k="Source Quantity" v={`${detailData.source_quantity} ${detailData.source_unit}`} />
                  {detailData.quantity_kwh && <DetailRow k="Energy (kWh)" v={detailData.quantity_kwh} />}
                  {detailData.distance_km && <DetailRow k="Distance (km)" v={detailData.distance_km} />}
                  <DetailRow k="Emission Factor" v={detailData.emission_factor ? `${detailData.emission_factor} kg CO2e/unit` : '—'} />
                  <DetailRow k="EF Source" v={detailData.emission_factor_source || '—'} />
                  <DetailRow k="kg CO2e" v={detailData.quantity_kg_co2e ? `${parseFloat(detailData.quantity_kg_co2e).toFixed(4)} kg` : '—'} highlight />
                </DetailSection>

                {detailData.flag_reason && (
                  <div style={{ marginBottom: 16, padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 5 }}>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--flagged)', marginBottom: 4 }}>FLAG REASON</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{detailData.flag_reason}</div>
                  </div>
                )}

                {detailData.raw_data && (
                  <DetailSection title="Raw Source Data">
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 4, padding: 12, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'auto', maxHeight: 140 }}>
                      {Object.entries(detailData.raw_data).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 2 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                          <span>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </DetailSection>
                )}

                {detailData.audit_logs?.length > 0 && (
                  <DetailSection title="Audit Trail">
                    {detailData.audit_logs.map((log, i) => (
                      <div key={i} style={{ marginBottom: 8, padding: '6px 8px', background: 'var(--bg-elevated)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: 'var(--accent-dim)' }}>{log.action}</span>
                        {log.field_changed && <span style={{ color: 'var(--text-muted)' }}> · {log.field_changed}</span>}
                        {log.old_value && <span style={{ color: 'var(--text-muted)' }}> {log.old_value}→{log.new_value}</span>}
                        <span style={{ color: 'var(--text-muted)' }}> by {log.performed_by} · {new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                    ))}
                  </DetailSection>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => { handleAction(detailData.id, 'approved'); setDetail(null); setDetailData(null) }} style={{ flex: 1, padding: '8px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--approved)', borderRadius: 4, fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    ✓ Approve
                  </button>
                  <button onClick={() => { handleAction(detailData.id, 'rejected'); setDetail(null); setDetailData(null) }} style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--rejected)', borderRadius: 4, fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    ✗ Reject
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Btn({ onClick, color, icon, children }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: `rgba(${color === 'var(--approved)' ? '16,185,129' : color === 'var(--rejected)' ? '239,68,68' : '245,158,11'},0.1)`, border: `1px solid rgba(${color === 'var(--approved)' ? '16,185,129' : color === 'var(--rejected)' ? '239,68,68' : '245,158,11'},0.25)`, color, borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-ui)', fontWeight: 600, cursor: 'pointer' }}>
      {icon}{children}
    </button>
  )
}

function FilterBtn({ active, onClick, children, scopeColor }) {
  return (
    <button onClick={onClick} style={{ padding: '4px 10px', background: active ? (scopeColor ? `rgba(${scopeColor.includes('orange') ? '249,115,22' : scopeColor.includes('blue') ? '59,130,246' : '168,85,247'},0.15)` : 'var(--accent-glow)') : 'var(--bg-elevated)', border: `1px solid ${active ? (scopeColor || 'var(--accent)') : 'var(--border)'}`, borderRadius: 4, color: active ? (scopeColor || 'var(--accent)') : 'var(--text-secondary)', fontSize: 11, fontFamily: 'var(--font-ui)', cursor: 'pointer', transition: 'all 0.12s' }}>
      {children}
    </button>
  )
}

function Th({ children }) {
  return <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{children}</th>
}

function Td({ children, mono }) {
  return <td style={{ padding: '8px 12px', color: mono ? undefined : 'var(--text-secondary)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: 12, verticalAlign: 'middle' }}>{children}</td>
}

function ActionBtn({ onClick, title, color, children }) {
  return (
    <button onClick={onClick} title={title} style={{ padding: '4px 6px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.1s' }}>
      {children}
    </button>
  )
}

function DetailSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

function DetailRow({ k, v, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: highlight ? 'var(--accent)' : 'var(--text-primary)', fontWeight: highlight ? 600 : 400 }}>{v}</span>
    </div>
  )
}

const paginBtnStyle = {
  padding: '4px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer'
}
