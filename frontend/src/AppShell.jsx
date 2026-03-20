/**
 * AppShell.jsx
 * Sits between the providers and the map; owns the top-level loading/error gate.
 *
 * ── Upload gate ───────────────────────────────────────────────────────────────
 * Before the map can load, the user must upload (or select the test) Excel file
 * via UploadScreen.  This ensures the backend always has a valid Excel loaded
 * before any API calls are made.
 *
 * ── Why useBootstrap lives in a child component ───────────────────────────────
 * useBootstrap() must only run after a valid Excel is on the server.  React's
 * rules of hooks prohibit conditional hook calls, so we split the shell into two
 * components: AppShell (renders the upload gate or the bootstrapped map) and
 * BootstrappedApp (calls useBootstrap, handles loading/error, renders AppMap).
 * BootstrappedApp only mounts once fileUploaded is true — no conditional hooks.
 *
 * ── Why AppShell exists (separation from App.jsx) ────────────────────────────
 * AppShell needs to call useAppState(), which reads from AppStateContext.  That
 * context is only available below <AppStateProvider> in the tree.  If this logic
 * lived directly in App.jsx (which renders AppStateProvider), the hook would be
 * called at the same level as the provider — useContext would return null.
 */

import { useBootstrap } from './hooks/useBootstrap'
import { useAppState }  from './state/appState'
import AppMap           from './components/map/AppMap'
import UploadScreen     from './components/UploadScreen'

// Map each loadingStep value to a user-facing Spanish message.
const LOADING_MESSAGES = {
  excel:     'Cargando datos del evento...',
  geocoding: 'Geolocalizando empleados...',
}

// ---------------------------------------------------------------------------
// BootstrappedApp — only mounted after the upload gate is cleared.
// Owns the useBootstrap() call so it never runs before a valid Excel exists.
// ---------------------------------------------------------------------------

function BootstrappedApp() {
  const { isLoading, error } = useBootstrap()
  const { state } = useAppState()

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    const message = LOADING_MESSAGES[state.loadingStep] ?? 'Cargando...'
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-base font-semibold text-destructive">
            Error al cargar los datos
          </p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground">
            Verificá que el servidor FastAPI esté corriendo en{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              {import.meta.env.VITE_API_BASE_URL}
            </code>
          </p>
        </div>
      </div>
    )
  }

  // ── Normal state: map fills the screen ────────────────────────────────────
  return <AppMap />
}

// ---------------------------------------------------------------------------
// AppShell — upload gate + bootstrapped map
// ---------------------------------------------------------------------------

export default function AppShell() {
  const { state } = useAppState()

  // ── Upload gate: show upload screen until a valid Excel is confirmed ───────
  if (!state.fileUploaded) {
    return <UploadScreen />
  }

  // ── Past the gate: bootstrap and render the map ───────────────────────────
  return <BootstrappedApp />
}
