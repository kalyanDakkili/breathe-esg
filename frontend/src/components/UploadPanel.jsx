import { useState, useRef } from 'react'
import { uploadFile } from '../api'
import { Upload, CheckCircle, AlertCircle, FileText, X } from 'lucide-react'

const SOURCES = [
  {
    id: 'sap',
    label: 'SAP Fuel & Procurement',
    scope: 'Scope 1 / Scope 3',
    description: 'SAP flat-file CSV export (MIGO/MB51). Expects BUDAT, WERKS, MENGE, MEINS, MATNR, BWART columns.',
    example: 'SAP_MIGO_Export_Q4_2024.csv',
    color: '#f97316',
  },
  {
    id: 'utility',
    label: 'Utility / Electricity',
    scope: 'Scope 2',
    description: 'Utility portal CSV export. Expects BillingPeriodStart, BillingPeriodEnd, SiteReference, MeterSerialNumber, ConsumptionKWh.',
    example: 'EDF_Portal_Export_Oct-Dec2024.csv',
    color: '#3b82f6',
  },
  {
    id: 'travel',
    label: 'Corporate Travel',
    scope: 'Scope 3',
    description: 'Concur / Navan travel extract CSV. Expects TravelDate, ExpenseType, EmployeeID, Origin, Destination, Class.',
    example: 'Concur_Travel_Extract_Q4_2024.csv',
    color: '#a855f7',
  },
]

function SampleDownload({ sourceId }) {
  function generateSample() {
    const samples = {
      sap: `BUDAT,WERKS,MENGE,MEINS,MATNR,BWART,LIFNR
20241003,1001,2840,L,000000000010000001,201,VENDOR001
20241015,1002,1220,L,000000000010000001,201,VENDOR002
20241102,1001,430,L,000000000010000002,201,VENDOR001
20241118,1003,950,L,000000000010000001,201,VENDOR003
20241205,1001,3100,L,000000000010000001,201,VENDOR001
20241220,2001,410,KG,000000000010200001,201,VENDOR004`,
      utility: `AccountNumber,SiteReference,MeterSerialNumber,BillingPeriodStart,BillingPeriodEnd,ConsumptionKWh,GridRegion,ReadingType
ACC001,Birmingham Plant,M001,01/10/2024,31/10/2024,48320,UK,Actual
ACC001,Birmingham Plant,M001,01/11/2024,30/11/2024,51200,UK,Estimated
ACC001,Birmingham Plant,M001,01/12/2024,31/12/2024,55100,UK,Actual
ACC002,Manchester Warehouse,M002,01/10/2024,31/10/2024,29400,UK,Actual
ACC003,Glasgow Distribution,M003,01/10/2024,31/12/2024,22100,UK_SCOTLAND,Actual`,
      travel: `TravelDate,ExpenseType,EmployeeID,Origin,Destination,Class,DistanceKm
08/10/2024,Air Travel,E001,LHR,JFK,Economy,
22/10/2024,Air Travel,E002,BHX,AMS,Economy,
05/11/2024,Air Travel,E003,LHR,DXB,Business,
14/11/2024,Air Travel,E001,MAN,CDG,Economy,
08/10/2024,Hotel,E001,,,, 3
05/11/2024,Hotel,E003,,,,2
07/10/2024,Taxi,E001,,,,42
21/10/2024,Taxi,E002,,,,28`,
    }
    const blob = new Blob([samples[sourceId]], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sample_${sourceId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button onClick={generateSample} style={{
      fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-dim)',
      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
      textDecoration: 'underline', textDecorationStyle: 'dotted',
    }}>
      download sample CSV
    </button>
  )
}

export default function UploadPanel({ client, onUploaded }) {
  const [selected, setSelected] = useState('sap')
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef()

  async function handleUpload() {
    if (!file || !client) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await uploadFile(selected, client.slug, file)
      setResult(r.data)
      setTimeout(onUploaded, 2000)
    } catch (e) {
      setError(e.response?.data?.error || 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const src = SOURCES.find(s => s.id === selected)

  return (
    <div style={{ padding: 32, maxWidth: 700 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 4 }}>
          INGEST DATA
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Upload Emission Source</h2>
        {!client && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--flagged)', fontFamily: 'var(--font-mono)' }}>⚠ Select a client first</div>}
      </div>

      {/* Source selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => setSelected(s.id)} style={{
            padding: '14px 14px', textAlign: 'left', borderRadius: 8, cursor: 'pointer',
            background: selected === s.id ? 'var(--bg-elevated)' : 'var(--bg-card)',
            border: `1px solid ${selected === s.id ? s.color : 'var(--border)'}`,
            transition: 'all 0.12s',
            boxShadow: selected === s.id ? `0 0 0 1px ${s.color}22` : 'none',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: selected === s.id ? s.color : 'var(--text-primary)', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.scope}</div>
          </button>
        ))}
      </div>

      {/* Source info */}
      <div style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.6 }}>{src.description}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            e.g. <span style={{ color: 'var(--text-secondary)' }}>{src.example}</span>
          </div>
          <SampleDownload sourceId={selected} />
        </div>
      </div>

      {/* File drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
        style={{
          border: `2px dashed ${file ? src.color : 'var(--border)'}`,
          borderRadius: 8, padding: '28px 24px', textAlign: 'center', cursor: 'pointer',
          background: file ? `rgba(${src.color.includes('orange') ? '249,115,22' : src.color.includes('blue') ? '59,130,246' : '168,85,247'},0.04)` : 'var(--bg-card)',
          transition: 'all 0.15s',
          marginBottom: 16,
        }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
        {file ? (
          <div>
            <FileText size={24} color={src.color} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{file.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {(file.size / 1024).toFixed(1)} KB ·
              <button onClick={e => { e.stopPropagation(); setFile(null); setResult(null) }} style={{ background: 'none', border: 'none', color: 'var(--rejected)', cursor: 'pointer', marginLeft: 6, fontSize: 11 }}>
                remove
              </button>
            </div>
          </div>
        ) : (
          <div>
            <Upload size={24} color="var(--text-muted)" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Drop CSV here or click to browse</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>Accepts .csv files</div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--rejected)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <CheckCircle size={16} color="var(--approved)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--approved)' }}>Upload successful</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              ['Total Rows', result.rows_total],
              ['Parsed', result.rows_parsed],
              ['Failed', result.rows_failed],
              ['Flagged', result.rows_flagged],
            ].map(([label, val]) => (
              <div key={label} style={{ textAlign: 'center', padding: '8px', background: 'var(--bg-elevated)', borderRadius: 5 }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: label === 'Flagged' && val > 0 ? 'var(--flagged)' : label === 'Failed' && val > 0 ? 'var(--rejected)' : 'var(--text-primary)' }}>{val}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 6 }}>PARSE ERRORS (first 5)</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--rejected)', marginBottom: 2 }}>
                  Row {e.row}: {e.error}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 10 }}>
            Redirecting to records view…
          </div>
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={!file || !client || loading}
        style={{
          padding: '10px 24px', background: file && client && !loading ? src.color : 'var(--bg-elevated)',
          color: file && client && !loading ? '#fff' : 'var(--text-muted)',
          border: 'none', borderRadius: 6, fontFamily: 'var(--font-ui)', fontWeight: 700,
          fontSize: 13, letterSpacing: '0.05em', cursor: file && client && !loading ? 'pointer' : 'not-allowed',
          transition: 'all 0.15s',
        }}
      >
        {loading ? 'Processing…' : 'Ingest File'}
      </button>
    </div>
  )
}
