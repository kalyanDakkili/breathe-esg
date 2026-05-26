import { useState, useEffect } from 'react'
import { getClients, getSummary, getBatches } from '../api'
import { useAuth } from '../App'
import Sidebar from '../components/Sidebar'
import Overview from '../components/Overview'
import RecordTable from '../components/RecordTable'
import UploadPanel from '../components/UploadPanel'
import BatchList from '../components/BatchList'

export default function Dashboard() {
  const { user, setUser } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    getClients().then(r => {
      setClients(r.data)
      if (r.data.length > 0) setSelectedClient(r.data[0])
    })
  }, [])

  useEffect(() => {
    if (selectedClient) {
      getSummary(selectedClient.slug).then(r => setSummary(r.data))
    }
  }, [selectedClient])

  function handleLogout() {
    localStorage.clear()
    setUser(null)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        clients={clients}
        selectedClient={selectedClient}
        setSelectedClient={setSelectedClient}
        user={user}
        onLogout={handleLogout}
        summary={summary}
      />

      <main style={{
        flex: 1, overflow: 'auto',
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(ellipse 60% 40% at 80% 10%, rgba(0,229,160,0.03), transparent)'
      }}>
        {activeTab === 'overview' && (
          <Overview client={selectedClient} summary={summary} />
        )}
        {activeTab === 'records' && (
          <RecordTable client={selectedClient} />
        )}
        {activeTab === 'upload' && (
          <UploadPanel
            client={selectedClient}
            onUploaded={() => {
              setActiveTab('records')
              if (selectedClient) getSummary(selectedClient.slug).then(r => setSummary(r.data))
            }}
          />
        )}
        {activeTab === 'batches' && (
          <BatchList client={selectedClient} />
        )}
      </main>
    </div>
  )
}
