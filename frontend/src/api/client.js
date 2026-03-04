/**
 * api/client.js
 * Configured axios instance shared by all endpoint functions.
 *
 * Why a shared axios instance instead of raw fetch()?
 *   - Single place to set the base URL, headers, and interceptors.
 *   - All endpoints automatically pick up future changes (auth tokens,
 *     timeouts, retry logic) without touching individual files.
 *   - axios gives us automatic JSON serialization/deserialization,
 *     cleaner error objects, and a richer interceptor API.
 *
 * Why read the base URL from an env variable?
 *   - The FastAPI backend runs locally during development (port 8000)
 *     but may be hosted elsewhere in production.  Env vars let us switch
 *     targets without touching source code.
 *   - VITE_ prefix is required by Vite to expose variables to the browser
 *     bundle.  Variables without it are intentionally kept server-side.
 */

import axios from 'axios'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Response interceptor: log errors in development so the browser console
// shows the full FastAPI error detail without needing to open Network tab.
// In production (import.meta.env.PROD) we stay silent and let callers
// handle errors through React Query's error state.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      const status  = error.response?.status
      const detail  = error.response?.data?.detail ?? error.message
      const url     = error.config?.url
      console.error(`[API] ${status} ${url} —`, detail)
    }
    return Promise.reject(error)
  },
)

export default client
