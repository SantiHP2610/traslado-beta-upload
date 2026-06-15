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

import { useState }                    from 'react'
import { useAppState, ACTIONS }        from '../../state/appState'
import { recalculateRouteWithPickup }  from '../../api/endpoints'
import { Button }                      from '@/components/ui/button'

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

function PlaceOption({ place, onConfirm, confirming }) {
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
      <Button
        size="sm"
        className="w-full text-xs"
        disabled={confirming}
        onClick={() => onConfirm(place)}
      >
        {confirming ? 'Confirmando…' : 'Confirmar este pickup'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — renders flat content (no Card/absolute wrapper)
// ---------------------------------------------------------------------------

export default function PickupResultPanel() {
  const { state, dispatch } = useAppState()
  const [confirming, setConfirming] = useState(false)

  const activePickupResult = state.activePickupResult
  if (!activePickupResult) return null

  const { employeeName, result } = activePickupResult
  const candidate = result?.pickup_candidate

  function handleClose() {
    dispatch({ type: ACTIONS.SET_ACTIVE_PICKUP_RESULT, payload: null })
  }

  async function handleConfirm(place) {
    if (confirming) return
    setConfirming(true)

    const employee = state.staffWithCoords?.find((emp) => fullName(emp) === employeeName)

    // ── Recalculate route to include the pickup stop ─────────────────────────
    // Derive driver coordinates the same way AppMap does for manual pickup:
    //   1. Check coordinateOverrides for a user-repositioned driver marker.
    //   2. Fall back to staffWithCoords (geocoded by useBootstrap at startup).
    //   detect-personal-vehicle does not geocode staff, so driver.coordinates
    //   is not populated; staffWithCoords is the authoritative geocoded source.
    const driver         = state.personalVehicle?.driver
    const driverName     = driver ? `${driver.Nombre} ${driver.Apellido}` : null
    const override       = driverName ? state.coordinateOverrides[driverName] : null
    const driverWithCoords = driverName
      ? state.staffWithCoords?.find((e) => `${e.Nombre} ${e.Apellido}` === driverName)
      : null
    const driverCoords = {
      lat: override?.lat ?? driverWithCoords?.coordinates?.lat,
      lng: override?.lng ?? driverWithCoords?.coordinates?.lng,
    }

    // Timing fields populated from the route response; null on failure (shows
    // "Horario a confirmar" in the summary panels).
    let pickupBeforePe = null
    let legSeconds     = null

    try {
      const baseRoutePolyline = state.driverRoutes?.base_route?.encoded_polyline ?? ''
      const newRoute = await recalculateRouteWithPickup(
        driverCoords,
        { lat: state.chosenMeetingPoint.lat, lng: state.chosenMeetingPoint.lng },
        { lat: place.lat, lng: place.lng },
        state.eventCoords,
        baseRoutePolyline,
      )

      pickupBeforePe = newRoute.pickup_before_pe ?? null
      legSeconds     = newRoute.leg_seconds ?? null

      // Update the route that is currently active (base = PE chosen, direct = PEA chosen).
      const isPea = state.meetingPoint && state.chosenMeetingPoint && (
        Math.abs((state.chosenMeetingPoint?.lat || 0) - (state.meetingPoint?.lat || 0)) > 0.0001 ||
        Math.abs((state.chosenMeetingPoint?.lng || 0) - (state.meetingPoint?.lng || 0)) > 0.0001
      )
      const updatedRoutes = isPea
        ? { ...state.driverRoutes, direct_route: { ...state.driverRoutes.direct_route, encoded_polyline: newRoute.encoded_polyline } }
        : { ...state.driverRoutes, base_route:   { ...state.driverRoutes.base_route,   encoded_polyline: newRoute.encoded_polyline, legs: [] } }
      dispatch({ type: ACTIONS.SET_DRIVER_ROUTES, payload: updatedRoutes })
    } catch (err) {
      // Route recalculation failed — store the pickup assignment anyway.
      // The route simply stays unmodified; the manager sees the correct PE route.
      console.warn('[PickupResultPanel] Route recalculation failed:', err?.message)
    }

    // Automatic pickup always targets the personal vehicle (the context menu
    // "Buscar pickup en ruta" is only shown for personal-vehicle passengers).
    dispatch({
      type:    ACTIONS.SET_VEHICLE_PICKUP_POINT,
      payload: {
        vehicle_id: 'personal',
        point: {
          place_name:    place.place_name,
          place_address: place.place_address,
          lat:           place.lat,
          lng:           place.lng,
        },
      },
    })
    if (pickupBeforePe !== null || legSeconds !== null) {
      dispatch({
        type:    ACTIONS.SET_VEHICLE_ROUTE,
        payload: {
          vehicle_id: 'personal',
          route: {
            encoded_polyline: state.driverRoutes?.base_route?.encoded_polyline ?? '',
            pickup_before_pe: pickupBeforePe,
            leg_seconds:      legSeconds,
          },
        },
      })
    }
    dispatch({ type: ACTIONS.SET_ACTIVE_PICKUP_RESULT, payload: null })
    setConfirming(false)
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
                <PlaceOption key={i} place={place} onConfirm={handleConfirm} confirming={confirming} />
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
