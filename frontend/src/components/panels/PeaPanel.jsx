/**
 * PeaPanel.jsx
 * Floating info panel visible during step 2 (meeting-point selection).
 *
 * ── What this panel does ─────────────────────────────────────────────────────
 * This panel is INFORMATIONAL only.  It shows:
 *   1. Loading feedback while the three backend phases run.
 *   2. Instructions telling the user to select a point on the map.
 *   3. A collapsible route summary (distances/durations for both routes).
 *   4. A note on PEA availability (how many candidates, or none found).
 *   5. Once a point is chosen on the map, a confirmation view with a
 *      "Confirmar y asignar pasajeros" button to advance to step 3.
 *
 * ── Why there are no PE/PEA selection buttons here ───────────────────────────
 * The meeting-point decision is inherently spatial: the user needs to see the
 * routes, the staff addresses, and the candidate locations on the map together.
 * Providing selection buttons in the panel would let the user choose without
 * ever looking at the map, defeating the purpose of showing it.
 * All selection happens through InfoWindow footer buttons on the map markers.
 * This panel is purely a guide and a confirmation surface.
 *
 * ── Why the panel is always rendered (not only when loadingStep is set) ───────
 * The panel doubles as the guide text ("click a marker to choose") even when
 * all backend calls are complete.  Hiding it after loading would leave the user
 * with no instructions and no confirmation pathway.  The panel stays visible
 * throughout step 2 and disappears when the user advances to step 3.
 *
 * ── Position stacking ────────────────────────────────────────────────────────
 * FrescosPanel occupies top-4 left-4.  PeaPanel is positioned top-4 left-80
 * (w-72 = 288px + 1rem gap ≈ 320px = left-80) so the two panels sit side by
 * side without overlapping.  Both use z-10 to layer over the map canvas.
 */

import { useState }                    from 'react'
import { useAppState, ACTIONS }        from '../../state/appState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button }                      from '@/components/ui/button'

// ── Loading messages keyed on loadingStep ────────────────────────────────────
const LOADING_MESSAGES = {
  meeting_point: 'Calculando punto de encuentro...',
  routes:        'Calculando rutas del chofer...',
  pea:           'Evaluando puntos alternativos...',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${meters} m`
}

// ── Sub-component: inline spinner ────────────────────────────────────────────

function Spinner({ message }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  )
}

// ── Sub-component: collapsible route summary ─────────────────────────────────

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
          {/* Base route */}
          <div>
            <p className="font-medium text-blue-600">
              Ruta base (casa → PE → evento)
            </p>
            <p className="text-muted-foreground">
              {formatDuration(base.duration_seconds)} · {formatDistance(base.distance_meters)}
            </p>
          </div>
          {/* Direct route */}
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

// ── Main component ────────────────────────────────────────────────────────────

export default function PeaPanel() {
  const { state, dispatch } = useAppState()

  const { loadingStep, driverRoutes, peaEvaluation, chosenMeetingPoint,
          personalVehicle } = state

  const isLoading       = loadingStep !== null
  const driver          = personalVehicle?.driver
  const vehicleDesc     = personalVehicle?.vehicle_description ?? ''
  const driverName      = driver ? `${driver.Nombre} ${driver.Apellido}` : ''
  const hasCandidates   = peaEvaluation?.has_candidates ?? false
  const candidateCount  = peaEvaluation?.candidates?.length ?? 0

  function handleConfirm() {
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  return (
    // Position: absolute, to the right of FrescosPanel (w-72 = 288px, + 1rem
    // gap ≈ left-80 = 320px).  z-10 layers it above the map canvas.
    // pointer-events-auto is explicit documentation of intent.
    <div className="absolute top-4 left-80 z-10 w-72 pointer-events-auto">
      <Card className="shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Punto de encuentro</CardTitle>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">

          {/* ── Loading state ─────────────────────────────────────────── */}
          {isLoading && (
            <Spinner message={LOADING_MESSAGES[loadingStep] ?? 'Calculando...'} />
          )}

          {/* ── Loaded, no choice yet ─────────────────────────────────── */}
          {!isLoading && !chosenMeetingPoint && (
            <>
              {/* Instruction */}
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Seleccioná el punto de encuentro para el vehículo propio
                  {driverName && (
                    <span className="font-normal text-muted-foreground">
                      {' '}({driverName}
                      {vehicleDesc && ` — ${vehicleDesc}`})
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Hacé click sobre un marcador{' '}
                  <span className="font-medium text-green-600">verde (PE)</span>
                  {hasCandidates && (
                    <>
                      {' '}o{' '}
                      <span className="font-medium text-orange-500">naranja (PEA)</span>
                    </>
                  )}{' '}
                  en el mapa para ver las opciones.
                </p>
              </div>

              {/* Route summary (collapsible) */}
              <RouteSummary driverRoutes={driverRoutes} />

              {/* PEA availability note */}
              <div className="text-xs">
                {!peaEvaluation && null}

                {peaEvaluation && !hasCandidates && (
                  <p className="text-muted-foreground">
                    No se encontraron puntos alternativos. Solo está disponible
                    el PE original.
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

          {/* ── Point chosen ──────────────────────────────────────────── */}
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

        </CardContent>
      </Card>
    </div>
  )
}
