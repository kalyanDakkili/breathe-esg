import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getSummary } from '../api'
import { TrendingUp, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 8 }}>
            {label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {value}
          </div>
          {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{sub}</div>}
        </div>
        {Icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: `rgba(${color === 'var(--accent)' ? '0,229,160' : color === 'var(--flagged)' ? '245,158,11' : color === 'var(--approved)' ? '16,185,129' : '100,116,139'},0.1)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Icon size={16} color={color || 'var(--text-secondary)'} />
          </div>
        )}
      </div>
    </div>
  )
}

const SCOPE_COLORS = { scope_1: '#f97316', scope_2: '#3b82f6', scope_3: '#a855f7' }

export default function Overview({ client, summary }) {
  if (!summary) return (
    <div style={{ padding: 40, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      {client ? 'Loading…' : 'Select a client to begin'}
    </div>
  )

  const { scope_totals, status_counts, total_records } = summary

  const scopeData = [
    { name: 'Scope 1\nDirect', key: 'scope_1', value: scope_totals.scope_1?.kg_co2e || 0, count: scope_totals.scope_1?.count || 0 },
    { name: 'Scope 2\nElectricity', key: 'scope_2', value: scope_totals.scope_2?.kg_co2e || 0, count: scope_totals.scope_2?.count || 0 },
    { name: 'Scope 3\nValue Chain', key: 'scope_3', value: scope_totals.scope_3?.kg_co2e || 0, count: scope_totals.scope_3?.count || 0 },
  ]

  const totalCO2e = scopeData.reduce((a, b) => a + b.value, 0)

  function fmt(n) {
    if (n > 1000) return `${(n/1000).toFixed(1)}t`
    return `${n.toFixed(0)}kg`
  }

  const needsAction = (status_counts.pending || 0) + (status_counts.flagged || 0)

  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 4 }}>
          EMISSIONS OVERVIEW
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
          {client?.name}
        </h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {total_records} records ingested · {status_counts.approved || 0} approved · {needsAction} need action
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="TOTAL CO2e" value={fmt(totalCO2e)} sub="kg CO2-equivalent" color="var(--accent)" icon={TrendingUp} />
        <StatCard label="FLAGGED" value={status_counts.flagged || 0} sub="needs review" color="var(--flagged)" icon={AlertTriangle} />
        <StatCard label="APPROVED" value={status_counts.approved || 0} sub="locked for audit" color="var(--approved)" icon={CheckCircle} />
        <StatCard label="PENDING" value={status_counts.pending || 0} sub="awaiting review" color="var(--pending)" icon={Clock} />
      </div>

      {/* Scope breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 20px 12px' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 16 }}>
            CO2e BY SCOPE (kg)
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={scopeData} barSize={36}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#4a5568', fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#4a5568', fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 11 }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                itemStyle={{ color: 'var(--text-primary)' }}
                formatter={(v) => [`${v.toFixed(1)} kg CO2e`]}
              />
              <Bar dataKey="value" radius={[3,3,0,0]}>
                {scopeData.map(d => <Cell key={d.key} fill={SCOPE_COLORS[d.key]} opacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Scope detail */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 16 }}>
            SCOPE DETAIL
          </div>
          {scopeData.map(d => (
            <div key={d.key} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.name.replace('\n', ' ')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: SCOPE_COLORS[d.key] }}>
                  {fmt(d.value)}
                </span>
              </div>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: SCOPE_COLORS[d.key],
                  width: totalCO2e > 0 ? `${(d.value / totalCO2e * 100).toFixed(0)}%` : '0%',
                  transition: 'width 0.6s ease',
                  opacity: 0.75,
                }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                {d.count} records · {totalCO2e > 0 ? (d.value / totalCO2e * 100).toFixed(1) : 0}% of total
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data quality note */}
      {(status_counts.flagged || 0) > 0 && (
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)',
          borderRadius: 6, display: 'flex', gap: 10, alignItems: 'flex-start'
        }}>
          <AlertTriangle size={14} color="var(--flagged)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--flagged)' }}>{status_counts.flagged} records flagged</strong> — automatic quality checks found issues.
            Review flagged records before approving for audit. Approved records are locked and cannot be edited.
          </div>
        </div>
      )}
    </div>
  )
}
