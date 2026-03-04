/**
 * AppShell.jsx
 * Sits between the providers and the map; owns the top-level loading/error gate.
 *
 * Separation from App.jsx:
 *   AppShell needs to call useBootstrap(), which calls useAppState(), which
 *   reads from AppStateContext.  That context is only available below
 *   <AppStateProvider> in the tree.  If this logic lived directly in App.jsx
 *   (which renders AppStateProvider), the hook would be called at the same
 *   level as the provider that creates the context — useContext would return
 *   null.  Moving it one level down solves this cleanly without an extra
 *   wrapper div or ref gymnastics.
 */

import { useBootstrap } from './hooks/useBootstrap'
import AppMap from './components/map/AppMap'

export default function AppShell() {
  const { isLoading, error } = useBootstrap()

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          {/* Simple CSS spinner — no external dependency needed for a single
              full-screen loader.  We avoid a shadcn/ui Spinner here so the
              loading screen has zero JS overhead while the bundle hydrates. */}
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">
            Cargando datos del evento...
          </p>
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
