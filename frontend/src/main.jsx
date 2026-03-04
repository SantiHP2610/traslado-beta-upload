/**
 * main.jsx — application entry point.
 *
 * Provider hierarchy (outermost → innermost):
 *
 *   StrictMode
 *     QueryClientProvider   ← React Query global client
 *       App
 *
 * Why React Query (QueryClientProvider)?
 *   All backend calls in this app are asynchronous and have shared state
 *   concerns: loading indicators, error boundaries, caching between steps,
 *   and automatic retries.  React Query manages all of that declaratively
 *   so individual components can call useQuery / useMutation without
 *   hand-rolling useState + useEffect patterns.  The QueryClient is
 *   created once here and injected via context so every component tree
 *   below can access it without prop drilling.
 *
 * Why wrap everything in StrictMode?
 *   StrictMode double-invokes renders and effects in development to surface
 *   side-effect bugs early.  It has no effect on production builds.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'

// Create a single QueryClient for the app lifetime.
// defaultOptions can be tuned here globally (e.g. retry count, stale time).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry on 4xx errors — they indicate a logic/validation problem,
      // not a transient network failure.  Let the error surface immediately.
      retry: (failureCount, error) => {
        if (error?.response?.status >= 400 && error?.response?.status < 500) {
          return false
        }
        return failureCount < 2
      },
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
