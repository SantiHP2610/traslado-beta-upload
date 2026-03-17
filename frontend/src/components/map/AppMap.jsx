/**
 * AppMap.jsx
 * Full-screen Google Map canvas with layout-switching side panels.
 *
 * ── Layout model ───────────────────────────────────────────────────────────
 * The outer div is a flex row that fills the viewport.
 * Steps 1-2:  [Sidebar 380px] [map flex:1]
 * Step 3:     [UnassignedPanel 300px] [map flex:1] [AssignmentSummaryPanel 320px]
 * Step 4+:    [map flex:1]  — modal/output overlaid via position:fixed
 *
 * The map area div always occupies flex:1 and holds position:relative so that
 * absolutely-positioned children (back button, gear icon, ConfigPanel,
 * MeetingPointCard) are anchored to the visible map canvas in every layout.
 *
 * ── Why <Map> must stay at the same tree position ─────────────────────────
 * Switching layouts must NOT unmount the <Map> component.  If React replaces
 * it with a new instance the Maps JS API reinitialises the tile grid, losing
 * all markers and causing a visible flash.  Keeping the <Map> as a direct
 * child of the same map-area div in every branch guarantees React reconciles
 * it in-place — null side panels don't shift its tree position.
 *
 * ── Components inside <Map> ───────────────────────────────────────────────
 * MapBoundsController, StaffMarkers, RoutePolylines, MeetingPointMarkers,
 * EventMarker, PickupCandidateMarkers all use useMap() and must be
 * descendants of <Map>.
 *
 * ── Floating panels outside <Map> ────────────────────────────────────────
 * All side panels are siblings of <Map> (inside the flex row or the map-area
 * div) — the Maps JS API owns the DOM inside <Map>, so React nodes appended
 * there can conflict with its internal rendering.
 *
 * ── Assignment logic ─────────────────────────────────────────────────────
 * useAssignmentLogic() is called here so the same state instance (local
 * useState + useEffect) is shared between UnassignedPanel (left) and
 * AssignmentSummaryPanel (right).  Both panels receive the results as props.
 */

import { useMemo, useEffect, useState, useCallback } from 'react'
import { Map, AdvancedMarker, Pin, InfoWindow }      from '@vis.gl/react-google-maps'
import { ChevronLeft }                               from 'lucide-react'
import polyline                                      from '@mapbox/polyline'
import { useAppState, ACTIONS }                      from '../../state/appState'
import { pickupPlaceInfo, recalculateRouteWithPickup } from '../../api/endpoints'
import { useStepTwo }                    from '../../hooks/useStepTwo'
import { useAssignmentLogic }            from '../../hooks/useAssignmentLogic'
import MapBoundsController               from './MapBoundsController'
import StaffMarkers                      from './StaffMarkers'
import RoutePolylines                    from './RoutePolylines'
import MeetingPointMarkers               from './MeetingPointMarkers'
import EventMarker                       from './EventMarker'
import PickupCandidateMarkers            from './PickupCandidateMarkers'
import Sidebar                           from '../panels/Sidebar'
import UnassignedPanel                   from '../panels/UnassignedPanel'
import AssignmentSummaryPanel            from '../panels/AssignmentSummaryPanel'
import MeetingPointCard                  from '../panels/MeetingPointCard'
import ConfirmationModal                 from '../panels/ConfirmationModal'
import FinalOutputBlocks                 from '../panels/FinalOutputBlocks'
import ConfigPanel, { GearButton }       from '../panels/ConfigPanel'

const BA_CENTER    = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 11

// Distance threshold (metres) beyond which a map click is too far from the
// route to be considered a valid pickup point.  Clicks within this radius
// proceed; clicks between PICKUP_WARNING_M and PICKUP_REJECT_M show a
// warning but still proceed; clicks beyond PICKUP_REJECT_M are ignored.
const PICKUP_WARNING_M = 500
const PICKUP_REJECT_M  = 3000

/**
 * Haversine distance in metres between two {lat, lng} points.
 * Used to measure how far a clicked point is from the nearest polyline vertex.
 */
function haversineMetres(a, b) {
  const R    = 6_371_000
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLng = (b.lng - a.lng) * (Math.PI / 180)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat +
    Math.cos(a.lat * (Math.PI / 180)) *
    Math.cos(b.lat * (Math.PI / 180)) *
    sinLng * sinLng
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Returns the minimum distance in metres from `point` to any vertex of the
 * decoded polyline.  `encodedPolyline` is a Google-encoded polyline string.
 */
function distanceToPolylineMetres(point, encodedPolyline) {
  const vertices = polyline.decode(encodedPolyline)
  let min = Infinity
  for (const [lat, lng] of vertices) {
    const d = haversineMetres(point, { lat, lng })
    if (d < min) min = d
  }
  return min
}

// ---------------------------------------------------------------------------
// Bounds computation (unchanged from original)
// ---------------------------------------------------------------------------

function getRouteEndpoints(encodedPolyline) {
  if (!encodedPolyline) return []
  const decoded = polyline.decode(encodedPolyline)
  if (decoded.length === 0) return []
  const [[lat0, lng0]] = decoded
  const [latN, lngN]   = decoded[decoded.length - 1]
  return [
    { lat: lat0, lng: lng0 },
    { lat: latN, lng: lngN },
  ]
}

function computeBounds(staffWithCoords, driverRoutes, eventCoords) {
  const points = []

  if (staffWithCoords) {
    for (const emp of staffWithCoords) {
      if (emp.coordinates) points.push(emp.coordinates)
    }
  }

  if (driverRoutes) {
    points.push(...getRouteEndpoints(driverRoutes.base_route?.encoded_polyline))
    points.push(...getRouteEndpoints(driverRoutes.direct_route?.encoded_polyline))
  }

  if (eventCoords) {
    points.push(eventCoords)
  }

  if (points.length === 0) return null

  const lats = points.map((c) => c.lat)
  const lngs = points.map((c) => c.lng)
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east:  Math.max(...lngs),
    west:  Math.min(...lngs),
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AppMap() {
  const { state, dispatch } = useAppState()
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined

  // Config panel visibility — purely local UI state.
  const [showConfig, setShowConfig] = useState(false)

  // Hover state for back button scale effect.
  const [backHover, setBackHover] = useState(false)

  // Manual pickup mode — InfoWindow state for a clicked point.
  // Shape: { lat, lng, name, address, types, opening_hours, loading, error, tooFar }
  // null = no InfoWindow shown.
  const [manualPickupInfo, setManualPickupInfo] = useState(null)

  // Whether we're currently calling /recalculate-route-with-pickup.
  const [recalculating, setRecalculating] = useState(false)

  // Trigger automatic backend calls on the step 1→2 transition.
  useStepTwo()

  // Extract assignment logic so UnassignedPanel and AssignmentSummaryPanel
  // share the same state instance via props (no additional context needed).
  const assignLogic = useAssignmentLogic()

  // ── Step 3: auto-assign driver ───────────────────────────────────────────
  // Initialise the assignments object with the driver the moment step 3
  // starts.  Guard on assignments === null so this fires exactly once.
  useEffect(() => {
    if (state.currentStep !== 3) return
    if (state.assignments !== null) return

    const driver = state.personalVehicle?.has_personal_vehicle
      ? state.personalVehicle.driver
      : null

    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: {
        driver,
        car_passengers:  [],
        uber_passengers: [],
        pickup_employee: null,
        pickup_place:    null,
      },
    })
  }, [state.currentStep, state.assignments, state.personalVehicle, dispatch])

  const bounds = useMemo(
    () => computeBounds(state.staffWithCoords, state.driverRoutes, state.eventCoords),
    [state.staffWithCoords, state.driverRoutes, state.eventCoords],
  )

  // ── Manual pickup map click ───────────────────────────────────────────────
  // When manualPickupMode is true, every click on the map is intercepted.
  // We check proximity to the current route polyline; if the click is within
  // PICKUP_REJECT_M metres we show an InfoWindow with place info.
  const handleMapClick = useCallback(async (event) => {
    if (!state.manualPickupMode || state.currentStep !== 3) return
    if (!event.detail?.latLng) return

    const { lat, lng } = event.detail.latLng
    const clickedPoint = { lat, lng }

    // Determine which polyline is active (same logic as RoutePolylines).
    const isPea = state.meetingPoint &&
      state.chosenMeetingPoint?.name !== state.meetingPoint?.name
    const activePolyline = isPea
      ? state.driverRoutes?.direct_route?.encoded_polyline
      : state.driverRoutes?.base_route?.encoded_polyline

    let tooFar = false
    let offRoute = false
    if (activePolyline) {
      const dist = distanceToPolylineMetres(clickedPoint, activePolyline)
      if (dist > PICKUP_REJECT_M) {
        offRoute = true
      } else if (dist > PICKUP_WARNING_M) {
        tooFar = true
      }
    }

    if (offRoute) return   // silently ignore clicks far from route

    // Show InfoWindow immediately with loading state, then fetch place info.
    setManualPickupInfo({ lat, lng, loading: true, tooFar, name: null, address: null, types: [], opening_hours: [] })

    try {
      const info = await pickupPlaceInfo(lat, lng)
      setManualPickupInfo({ ...info, loading: false, tooFar })
    } catch {
      setManualPickupInfo({ lat, lng, loading: false, tooFar, name: null, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, types: [], opening_hours: [], error: 'No se pudo obtener info del lugar.' })
    }
  }, [state.manualPickupMode, state.currentStep, state.meetingPoint, state.chosenMeetingPoint, state.driverRoutes])

  // When the user confirms a manually clicked pickup point.
  const handleConfirmManualPickup = useCallback(async () => {
    if (!manualPickupInfo || recalculating) return
    setRecalculating(true)

    const driver     = state.personalVehicle?.driver
    const driverName = driver ? `${driver.Nombre} ${driver.Apellido}` : null
    const override   = driverName ? state.coordinateOverrides[driverName] : null
    // detect-personal-vehicle does not geocode staff, so driver.coordinates is
    // not populated.  Look up the geocoded entry from staffWithCoords instead
    // (always populated by the bootstrap's geocodeStaff call).
    const driverWithCoords = driverName
      ? state.staffWithCoords?.find((e) => `${e.Nombre} ${e.Apellido}` === driverName)
      : null
    const driverCoords = {
      lat: override?.lat ?? driverWithCoords?.coordinates?.lat,
      lng: override?.lng ?? driverWithCoords?.coordinates?.lng,
    }
    const meetingPt = {
      lat: state.chosenMeetingPoint.lat,
      lng: state.chosenMeetingPoint.lng,
    }
    const pickupPt = { lat: manualPickupInfo.lat, lng: manualPickupInfo.lng }

    try {
      const newRoute = await recalculateRouteWithPickup(
        driverCoords, meetingPt, pickupPt, state.eventCoords,
      )

      // Update the base route polyline with the new route including pickup stop.
      // We store it as a modified base_route so RoutePolylines re-renders it.
      const isPea = state.meetingPoint &&
        state.chosenMeetingPoint?.name !== state.meetingPoint?.name
      const updatedRoutes = isPea
        ? {
            ...state.driverRoutes,
            direct_route: { ...state.driverRoutes.direct_route, encoded_polyline: newRoute.encoded_polyline },
          }
        : {
            ...state.driverRoutes,
            base_route: { ...state.driverRoutes.base_route, encoded_polyline: newRoute.encoded_polyline, legs: [] },
          }
      dispatch({ type: ACTIONS.SET_DRIVER_ROUTES, payload: updatedRoutes })

      // Store the pickup place on assignments.
      dispatch({
        type:    ACTIONS.SET_ASSIGNMENTS,
        payload: {
          ...state.assignments,
          pickup_place: {
            place_name:    manualPickupInfo.name ?? manualPickupInfo.address,
            place_address: manualPickupInfo.address,
            lat:           manualPickupInfo.lat,
            lng:           manualPickupInfo.lng,
          },
        },
      })

      dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: false })
      setManualPickupInfo(null)
    } catch (err) {
      setManualPickupInfo((prev) => ({ ...prev, error: 'Error al recalcular la ruta.' }))
    } finally {
      setRecalculating(false)
    }
  }, [manualPickupInfo, recalculating, state, dispatch])

  // ── Layout flags ─────────────────────────────────────────────────────────
  // Side panels are hidden while the step-4 modal or output panel is shown so
  // the user's focus stays on the confirmation / final output.
  const overlayActive   = state.showModal || state.showOutput
  const showSidebar     = state.currentStep <= 2 && !overlayActive
  const showStep3Panels = state.currentStep === 3 && !overlayActive

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display:  'flex',
        width:    '100vw',
        height:   '100vh',
        overflow: 'hidden',
      }}
    >
      {/* ── Left panel slot ──────────────────────────────────────────────── */}
      {showSidebar     && <Sidebar />}
      {showStep3Panels && (
        <UnassignedPanel
          unassigned={assignLogic.unassigned}
          totalToAssign={assignLogic.totalToAssign}
          hasAnyAssigned={assignLogic.assignedCount > 0}
          onReset={assignLogic.handleReset}
        />
      )}

      {/* ── Map area (always present, flex:1) ────────────────────────────── */}
      {/*
        The key prop is intentionally omitted here — React reconciles by
        tree position, so the <Map> component stays mounted across all
        layout switches without needing an explicit key.
      */}
      <div
        style={{
          flex:     1,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Map
          defaultCenter={BA_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          mapId={mapId}
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{
            width:  '100%',
            height: '100%',
            cursor: state.manualPickupMode && state.currentStep === 3 ? 'crosshair' : undefined,
          }}
          onClick={state.manualPickupMode && state.currentStep === 3 ? handleMapClick : undefined}
        >
          <MapBoundsController bounds={bounds} />

          {state.staffWithCoords && (
            <StaffMarkers staff={state.staffWithCoords} />
          )}

          {state.driverRoutes && <RoutePolylines />}

          {state.meetingPoint && state.currentStep >= 2 && (
            <MeetingPointMarkers />
          )}

          {state.staffWithCoords && <EventMarker />}

          {state.activePickupResult && <PickupCandidateMarkers />}

          {state.currentStep >= 3 && state.assignments?.pickup_place && (
            <AdvancedMarker
              position={{
                lat: state.assignments.pickup_place.lat,
                lng: state.assignments.pickup_place.lng,
              }}
              title={`Pickup: ${state.assignments.pickup_place.place_name}`}
            >
              <Pin
                background="#FFC107"
                borderColor="#e6a800"
                glyphColor="#1a1a1a"
              />
            </AdvancedMarker>
          )}

          {/* Manual pickup InfoWindow — shown when user clicks during pickup mode */}
          {manualPickupInfo && (
            <InfoWindow
              position={{ lat: manualPickupInfo.lat, lng: manualPickupInfo.lng }}
              onCloseClick={() => setManualPickupInfo(null)}
            >
              <div style={{ minWidth: 200, maxWidth: 260, fontFamily: 'sans-serif' }}>
                {manualPickupInfo.loading ? (
                  <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>Cargando…</p>
                ) : (
                  <>
                    {manualPickupInfo.name && (
                      <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', color: '#111827' }}>
                        {manualPickupInfo.name}
                      </p>
                    )}
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.4 }}>
                      {manualPickupInfo.address}
                    </p>
                    {manualPickupInfo.opening_hours?.length > 0 && (
                      <p style={{ fontSize: 11, color: '#374151', margin: '0 0 6px' }}>
                        {manualPickupInfo.opening_hours[0]}
                      </p>
                    )}
                    {manualPickupInfo.tooFar && (
                      <p style={{ fontSize: 11, color: '#b45309', margin: '0 0 8px', background: '#fffbeb', padding: '4px 6px', borderRadius: 4 }}>
                        ⚠ Este punto está a más de 500m de la ruta — se agregará un desvío.
                      </p>
                    )}
                    {manualPickupInfo.error && (
                      <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 8px' }}>
                        {manualPickupInfo.error}
                      </p>
                    )}
                    <button
                      onClick={handleConfirmManualPickup}
                      disabled={recalculating}
                      style={{
                        width:        '100%',
                        padding:      '7px 12px',
                        background:   recalculating ? '#374151' : '#111827',
                        color:        '#fff',
                        border:       'none',
                        borderRadius: 6,
                        fontSize:     12,
                        fontWeight:   600,
                        cursor:       recalculating ? 'default' : 'pointer',
                      }}
                    >
                      {recalculating ? 'Recalculando…' : 'Confirmar como pickup'}
                    </button>
                  </>
                )}
              </div>
            </InfoWindow>
          )}
        </Map>

        {/* Center-bottom card showing the chosen meeting point (step 3) */}
        {state.currentStep >= 3 && state.chosenMeetingPoint && (
          <MeetingPointCard />
        )}

        {/*
          "Volver atrás" button — top-left of map canvas, more prominent than
          the original bottom-left position.  Visible while there is history
          to pop and the final output panel is not displayed (the output panel
          has its own "Volver a editar" button).
        */}
        {state.stepHistory.length > 0 && !state.showOutput && (
          <button
            onClick={() => dispatch({ type: ACTIONS.STEP_BACK })}
            onMouseEnter={() => setBackHover(true)}
            onMouseLeave={() => setBackHover(false)}
            style={{
              position:      'absolute',
              top:           16,
              left:          16,
              zIndex:        10,
              pointerEvents: 'auto',
              display:       'flex',
              alignItems:    'center',
              gap:           6,
              padding:       '8px 14px',
              minHeight:     40,
              background:    '#ffffff',
              border:        'none',
              borderRadius:  8,
              boxShadow:     backHover
                ? '0 4px 16px rgba(0,0,0,0.22)'
                : '0 2px 8px rgba(0,0,0,0.18)',
              fontSize:      13,
              fontWeight:    500,
              color:         '#374151',
              cursor:        'pointer',
              transform:     backHover ? 'scale(1.05)' : 'scale(1)',
              transition:    'transform 150ms ease, box-shadow 150ms ease',
            }}
          >
            <ChevronLeft size={16} />
            Volver atrás
          </button>
        )}

        {/* Gear icon — always visible, top-right corner */}
        <GearButton
          onClick={() => setShowConfig((v) => !v)}
          active={showConfig}
        />

        {/* Config panel — slides in from the right edge of the map area */}
        {showConfig && (
          <ConfigPanel onClose={() => setShowConfig(false)} />
        )}
      </div>

      {/* ── Right panel slot ─────────────────────────────────────────────── */}
      {showStep3Panels && (
        <AssignmentSummaryPanel
          driver={assignLogic.driver}
          carPassengers={assignLogic.carPassengers}
          uberPassengers={assignLogic.uberPassengers}
          uberGroups={assignLogic.uberGroups}
          pickupEmployee={assignLogic.pickupEmployee}
          pickupPlace={assignLogic.pickupPlace}
          hasVehicle={assignLogic.hasVehicle}
          vehicleLabel={assignLogic.vehicleLabel}
          assignedCount={assignLogic.assignedCount}
          totalToAssign={assignLogic.totalToAssign}
          validating={assignLogic.validating}
          showSoloChoice={assignLogic.showSoloChoice}
          pendingSolo={assignLogic.pendingSolo}
          unassigned={assignLogic.unassigned}
          assignments={assignLogic.assignments}
          onValidate={assignLogic.handleValidate}
          onPendiente={assignLogic.handlePendiente}
          onContinueWithSolo={assignLogic.handleContinueWithSolo}
        />
      )}

      {/* ── Step 4 overlays (position:fixed — independent of flex layout) ── */}
      {state.showModal  && <ConfirmationModal />}
      {state.showOutput && <FinalOutputBlocks />}
    </div>
  )
}
