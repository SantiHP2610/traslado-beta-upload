/**
 * PickupResultPanel.jsx
 * Floating panel shown when a "Buscar pickup en ruta" call returns.
 *
 * ── What this panel shows ─────────────────────────────────────────────────────
 * 1. Employee name and transit summary for the found cross-point.
 * 2. Warning flags (transit time or time-saving outside recommended range).
 * 3. Up to 3 venue options (place_options) sorted by distance to cross-point.
 *    Each venue has a "Confirmar este pickup" button.
 * 4. A "Cerrar" button to dismiss without confirming.
 *
 * ── What "Confirmar" does ─────────────────────────────────────────────────────
 * - Sets assignments.pickup_employee to the employee object.
 * - Sets assignments.pickup_place to the chosen venue.
 * - Clears activePickupResult from state (closes this panel).
 * The employee's marker turns yellow in StaffMarkers automatically because
 * getMarkerColors() checks assignments.pickup_employee on the next render.
 *
 * ── Position ─────────────────────────────────────────────────────────────────
 * top-4 right-4 — the only quadrant not occupied by another panel.
 * FrescosPanel and AssignmentPanel both occupy the left side.
 * z-20 puts this panel above the z-10 panels to signal it requires attention.
 *
 * ── Why this panel is separate from the context menu ─────────────────────────
 * The find-pickup call is async and may take several seconds.  Blocking the
 * context menu open for that duration would freeze the map interaction.
 * Instead, the context menu fires the call and closes immediately, and this
 * panel appears when the response arrives — a standard "pending result" panel
 * pattern that lets the user continue interacting with the map while waiting.
 */

import { useAppState, ACTIONS }          from '../../state/appState'
import { Card, CardContent, CardHeader,
         CardTitle }                     from '@/components/ui/card'
import { Button }                        from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

function formatMeters(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

// ---------------------------------------------------------------------------
// Sub-component: single venue option
// ---------------------------------------------------------------------------

function PlaceOption({ place, onConfirm }) {
  return (
    <div className="rounded-md border border-border p-2.5 space-y-1.5">
      <div>
        <p className="text-xs font-medium leading-tight">{place.place_name}</p>
        <p className="text-xs text-muted-foreground leading-tight">
          {place.place_address}
        </p>
      </div>

      {/* Distance to driver's cross-point on the route */}
      <p className="text-xs text-muted-foreground">
        {formatMeters(place.dist_to_cross_m ?? 0)} del cruce
      </p>

      <Button
        size="sm"
        className="w-full text-xs"
        onClick={() => onConfirm(place)}
      >
        Confirmar este pickup
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PickupResultPanel() {
  const { state, dispatch } = useAppState()

  const activePickupResult = state.activePickupResult
  if (!activePickupResult) return null

  const { employeeName, result } = activePickupResult
  const candidate = result?.pickup_candidate

  function handleClose() {
    dispatch({ type: ACTIONS.SET_ACTIVE_PICKUP_RESULT, payload: null })
  }

  function handleConfirm(place) {
    // Look up the full employee object so the marker can use it directly.
    const employee = state.staffWithCoords?.find(
      (emp) => fullName(emp) === employeeName,
    )

    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: {
        ...(state.assignments ?? {}),
        pickup_employee: employee ?? null,
        pickup_place:    place,
      },
    })

    dispatch({ type: ACTIONS.SET_ACTIVE_PICKUP_RESULT, payload: null })
  }

  return (
    <div className="absolute top-4 right-4 z-20 w-72 pointer-events-auto">
      <Card className="shadow-lg">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight">
              Pickup — {employeeName}
            </CardTitle>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm shrink-0"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">

          {/* ── No candidate ────────────────────────────────────────── */}
          {!candidate && (
            <p className="text-sm text-muted-foreground">
              {result?.reason ?? 'No se encontró un punto de pickup viable.'}
            </p>
          )}

          {/* ── Candidate found ──────────────────────────────────────── */}
          {candidate && (
            <>
              {/* Transit summary */}
              <div className="space-y-0.5 text-xs">
                <p>
                  <span className="font-medium">{candidate.transit_time_to_pickup_minutes} min</span>
                  {' '}al punto de cruce
                </p>
                <p className="text-muted-foreground">
                  Ahorra {candidate.time_saved_minutes} min vs ir al PE directamente
                </p>
              </div>

              {/* Warnings */}
              {candidate.transit_warning && (
                <p className="text-xs text-amber-600">
                  ⚠ Tiempo de tránsito alto ({candidate.transit_time_to_pickup_minutes} min).
                  Verificar con el empleado.
                </p>
              )}
              {candidate.time_saving_warning && (
                <p className="text-xs text-amber-600">
                  ⚠ Ahorro de tiempo bajo ({candidate.time_saved_minutes} min).
                  El pickup puede no ser conveniente.
                </p>
              )}

              {/* Place options */}
              {candidate.place_options?.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Venues disponibles
                  </p>
                  {candidate.place_options.map((place, i) => (
                    <PlaceOption
                      key={i}
                      place={place}
                      onConfirm={handleConfirm}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No se encontraron venues sobre la ruta. El cruce existe pero no
                  hay lugares de referencia cercanos.
                </p>
              )}
            </>
          )}

          {/* Close without confirming */}
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleClose}>
            Cerrar sin confirmar
          </Button>

        </CardContent>
      </Card>
    </div>
  )
}
