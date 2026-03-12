/**
 * PeaPanel.jsx
 * Step 2 content — rendered inside Sidebar below FrescosPanel.
 * No absolute positioning, no Card wrapper.
 *
 * All logic and state dispatches are IDENTICAL to the original.
 * Only the outermost DOM structure changed: position:absolute wrapper and
 * Card wrapper removed.  Sidebar provides the section container.
 */

import { useState }                from 'react'
import { useAppState, ACTIONS }    from '../../state/appState'
import { Button }                  from '@/components/ui/button'

// ── Loading messages keyed on loadingStep ─────────────────────────────────
const LOADING_MESSAGES = {
  meeting_point: 'Calculando punto de encuentro...',
  routes:        'Calculando rutas del chofer...',
  pea:           'Evaluando puntos alternativos...',
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${meters} m`
}

// ── Sub-component: inline spinner ─────────────────────────────────────────

function Spinner({ message }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  )
}

// ── Sub-component: collapsible route summary ──────────────────────────────

function RouteSummary({ driverRoutes }) {
  const [open, setOpen] = useState(false)
  if (!driverRoutes) return null

  const base   = driverRoutes.base_route
  const direct = driverRoutes.direct_route

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Resumen de rutas</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 text-xs pl-3 border-l border-border">
          <div>
            <p className="font-medium text-blue-600">
              Ruta base (casa → PE → evento)
            </p>
            <p className="text-muted-foreground">
              {formatDuration(base.duration_seconds)} · {formatDistance(base.distance_meters)}
            </p>
          </div>
          <div>
            <p className="font-medium text-red-500">
              Ruta directa (casa → evento)
            </p>
            <p className="text-muted-foreground">
              {formatDuration(direct.duration_seconds)} · {formatDistance(direct.distance_meters)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PeaPanel() {
  const { state, dispatch } = useAppState()

  const { loadingStep, driverRoutes, peaEvaluation, chosenMeetingPoint,
          personalVehicle } = state

  const isLoading      = loadingStep !== null
  const driver         = personalVehicle?.driver
  const vehicleDesc    = personalVehicle?.vehicle_description ?? ''
  const driverName     = driver ? `${driver.Nombre} ${driver.Apellido}` : ''
  const hasCandidates  = peaEvaluation?.has_candidates ?? false
  const candidateCount = peaEvaluation?.candidates?.length ?? 0

  function handleConfirm() {
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  return (
    <div className="space-y-3">
      <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>
        Punto de encuentro
      </p>

      {/* ── Loading state ───────────────────────────────────────────── */}
      {isLoading && (
        <Spinner message={LOADING_MESSAGES[loadingStep] ?? 'Calculando...'} />
      )}

      {/* ── Loaded, no choice yet ───────────────────────────────────── */}
      {!isLoading && !chosenMeetingPoint && (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Seleccioná el punto de encuentro para{' '}
              {vehicleDesc && driverName
                ? `${vehicleDesc} de ${driverName}`
                : driverName
                  ? `el vehículo de ${driverName}`
                  : 'el vehículo'}
            </p>
            <p className="text-xs text-muted-foreground">
              Hacé click sobre un marcador{' '}
              <span className="font-medium text-yellow-500">amarillo (PE)</span>
              {hasCandidates && (
                <>
                  {' '}o{' '}
                  <span className="font-medium text-orange-500">naranja (PEA)</span>
                </>
              )}{' '}
              en el mapa para ver las opciones.
            </p>
          </div>

          <RouteSummary driverRoutes={driverRoutes} />

          <div className="text-xs">
            {peaEvaluation && !hasCandidates && (
              <p className="text-muted-foreground">
                No se encontraron puntos alternativos. Solo está disponible el PE original.
              </p>
            )}
            {peaEvaluation && hasCandidates && (
              <p>
                Hay{' '}
                <span className="font-medium text-orange-500">
                  {candidateCount} punto{candidateCount !== 1 ? 's' : ''} alternativo{candidateCount !== 1 ? 's' : ''}
                </span>
                {' '}disponible{candidateCount !== 1 ? 's' : ''} (marcadores naranjas).
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Point chosen ────────────────────────────────────────────── */}
      {!isLoading && chosenMeetingPoint && (
        <div className="space-y-3">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Punto elegido
            </p>
            <p className="text-sm font-medium text-foreground">
              ✓ {chosenMeetingPoint.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {chosenMeetingPoint.address}
            </p>
          </div>
          <Button className="w-full" onClick={handleConfirm}>
            Confirmar y asignar pasajeros
          </Button>
        </div>
      )}

      {/* Inline error */}
      {state.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </div>
  )
}
