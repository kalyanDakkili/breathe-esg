import { useState, useEffect, createContext, useContext } from 'react'
import { getMe } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) {
      getMe().then(r => setUser(r.data)).catch(() => localStorage.clear()).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)', fontFamily:'var(--font-mono)', fontSize:13 }}>
      initializing…
    </div>
  )

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {user ? <Dashboard /> : <Login onLogin={setUser} />}
    </AuthContext.Provider>
  )
}
