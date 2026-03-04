/**
 * App.jsx — root component.
 *
 * Provider hierarchy (outermost → innermost):
 *
 *   AppStateProvider      ← global useReducer state for the whole app flow
 *     QueryClientProvider ← React Query (in main.jsx, above this component)
 *       APIProvider       ← Google Maps JS API loaded once for the session
 *         AppShell        ← handles bootstrap loading/error before rendering map
 *
 * ── Why APIProvider lives here, not inside AppMap ────────────────────────────
 * APIProvider injects the Google Maps JavaScript API script into the page
 * exactly once and exposes a React context that all child hooks
 * (useMap, useMapsLibrary, etc.) depend on.  If it lived inside AppMap,
 * any unmount/remount of AppMap (e.g. switching views, toggling a modal)
 * would re-inject the script and reset all map state.  Hoisting it to the
 * app root guarantees the API is loaded once for the entire session.
 *
 * ── Why warn on missing API key rather than crashing ─────────────────────────
 * During initial development the .env file may not yet have a key.  A
 * console warning makes the problem immediately visible without breaking
 * the rest of the UI (state panels, step controls) that do not depend on
 * the map canvas.
 */

import { APIProvider } from '@vis.gl/react-google-maps'
import { AppStateProvider } from './state/appState'
import AppShell from './AppShell'

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

if (!MAPS_API_KEY && import.meta.env.DEV) {
  console.warn(
    '[App] VITE_GOOGLE_MAPS_API_KEY is not set in frontend/.env. ' +
    'The map will not load until a valid key is provided.'
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <APIProvider apiKey={MAPS_API_KEY ?? ''}>
        <AppShell />
      </APIProvider>
    </AppStateProvider>
  )
}
