import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({ baseURL: BASE_URL })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('access_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  async err => {
    if (err.response?.status === 401) {
      const refresh = localStorage.getItem('refresh_token')
      if (refresh) {
        try {
          const { data } = await axios.post(`${BASE_URL}/api/token/refresh/`, { refresh })
          localStorage.setItem('access_token', data.access)
          err.config.headers.Authorization = `Bearer ${data.access}`
          return axios(err.config)
        } catch {
          localStorage.clear()
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(err)
  }
)

export const login = (username, password) =>
  api.post('/api/token/', { username, password })

export const getMe = () => api.get('/api/me/')
export const getClients = () => api.get('/api/clients/')
export const getSummary = (clientSlug) => api.get('/api/summary/', { params: { client_slug: clientSlug } })
export const getBatches = (clientSlug) => api.get('/api/batches/', { params: { client_slug: clientSlug } })
export const getRecords = (params) => api.get('/api/records/', { params })
export const getRecord = (id) => api.get(`/api/records/${id}/`)
export const patchRecord = (id, data) => api.patch(`/api/records/${id}/`, data)
export const bulkAction = (data) => api.post('/api/records/bulk-action/', data)
export const uploadFile = (sourceType, clientSlug, file) => {
  const form = new FormData()
  form.append('file', file)
  form.append('client_slug', clientSlug)
  return api.post(`/api/upload/${sourceType}/`, form)
}

export default api
