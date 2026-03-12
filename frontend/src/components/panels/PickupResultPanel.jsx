/**
 * PickupResultPanel.jsx
 * Pickup search results panel.
 *
 * Rendered INLINE inside AssignmentSummaryPanel (right panel, step 3) when
 * activePickupResult is set — no absolute positioning, no Card wrapper.
 * AssignmentSummaryPanel wraps it in a bordered container.
 *
 * All logic, handlers, and state dispatches are IDENTICAL to the original.
 * Only the outermost DOM structure changed: the position:absolute + Card
 * wrapper is removed.
 */

import { useState }              from 'react'
import { useAppState, ACTIONS }  from '../../state/appState'
import { Button }                from '@/components/ui/button'

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
  const [showHours, setShowHours] = useState(false)
  const hours = place.opening_hours ?? []

  return (
    <div className="rounded-md border border-border p-2.5 space-y-1.5">
      <div>
        <p className="text-xs font-medium leading-tight">{place.place_name}</p>
        <p className="text-xs text-muted-foreground leading-tight">
          {place.place_address}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatMeters(place.dist_to_cross_m ?? 0)} del cruce
      </p>
      {hours.length > 0 && (
        <div>
          <button
            onClick={() => setShowHours((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHours ? '▲ Ocultar horarios' : '▼ Ver horarios'}
          </button>
          {showHours && (
            <ul className="mt-1 space-y-0.5 pl-0 list-none">
              {hours.map((line, i) => (
                <li key={i} className="text-[10px] text-muted-foreground leading-tight">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Button size="sm" className="w-full text-xs" onClick={() => onConfirm(place)}>
        Confirmar este pickup
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — renders flat content (no Card/absolute wrapper)
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
    const employee = state.staffWithCoords?.find(
      (emp) => fullName(emp) === employeeName,
    )
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: {
        ...(state.assignments ?? {}),
        pickup_employee:        employee ?? null,
        pickup_place:           place,
        pickup_transit_minutes: candidate?.transit_time_to_pickup_minutes ?? null,
      },
    })
    dispatch({ type: ACTIONS.SET_ACTIVE_PICKUP_RESULT, payload: null })
  }

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-800 leading-tight">
          Pickup — {employeeName}
        </p>
        <button
          onClick={handleClose}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm shrink-0"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* No candidate */}
      {!candidate && (
        <p className="text-sm text-muted-foreground">
          {result?.reason ?? 'No se encontró un punto de pickup viable.'}
        </p>
      )}

      {/* Candidate found */}
      {candidate && (
        <div className="space-y-3">
          <div className="space-y-0.5 text-xs">
            <p>
              <span className="font-medium">{candidate.transit_time_to_pickup_minutes} min</span>
              {' '}al punto de cruce
            </p>
            <p className="text-muted-foreground">
              Ahorra {candidate.time_saved_minutes} min vs ir al PE directamente
            </p>
          </div>

          {candidate.transit_warning && (
            <p className="text-xs text-amber-600">
              ⚠ Tiempo de tránsito alto ({candidate.transit_time_to_pickup_minutes} min).
            </p>
          )}
          {candidate.time_saving_warning && (
            <p className="text-xs text-amber-600">
              ⚠ Ahorro de tiempo bajo ({candidate.time_saved_minutes} min).
            </p>
          )}

          {candidate.place_options?.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Venues disponibles
              </p>
              {candidate.place_options.map((place, i) => (
                <PlaceOption key={i} place={place} onConfirm={handleConfirm} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No se encontraron venues sobre la ruta.
            </p>
          )}
        </div>
      )}

      <Button variant="outline" size="sm" className="w-full text-xs mt-3" onClick={handleClose}>
        Cerrar sin confirmar
      </Button>
    </div>
  )
}
