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

import { useMemo, useEffect, useState, useRef, useCallback } from 'react'
import { Map, AdvancedMarker, Pin, InfoWindow }      from '@vis.gl/react-google-maps'
import { ChevronLeft }                               from 'lucide-react'
import polyline                                      from '@mapbox/polyline'
import { useAppState, ACTIONS }                      from '../../state/appState'
import { pickupPlaceInfo, recalculateRouteWithPickup, peaPlaceInfo } from '../../api/endpoints'
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

  // Manual PEA mode — InfoWindow state for a point clicked during step 2.
  // Shape: { lat, lng, name, address, primary_type, opening_hours, staff_metrics, loading, error, tooFar }
  // null = no InfoWindow shown.
  const [manualPeaInfo, setManualPeaInfo] = useState(null)

  // Ref that tracks the current drag position of the Uber PE drag pin so we
  // can read the final position in onDragEnd regardless of event shape.
  const uberDragPosRef = useRef(null)

  // ── Uber PE edit marker animation ────────────────────────────────────────
  // The animated black marker that appears whenever uberPeEditMode is set.
  // Reuses the same ease-out-cubic logic as StaffMarkers.useAnimatedPosition.
  //   uberEditSnappedPos — React-known position (position prop on AdvancedMarker).
  //                        Only updated once per animation (at completion) so
  //                        React's position-binding stays dormant during frames.
  //   uberEditMarkerRef  — ref to the AdvancedMarkerElement; mutated each frame.
  //   uberEditPosRef     — current interpolated position (avoids reading state).
  //   uberEditRafRef     — active rAF handle so we can cancel on re-trigger.
  //   uberDragJustDoneRef — set true in onDragEnd to suppress animation when the
  //                         position change is caused by a drag (not geocode).
  //   uberPrevGroupRef   — detects group switches (instant jump, not animate).
  const uberEditMarkerRef   = useRef(null)
  const uberEditPosRef      = useRef(null)
  const uberEditRafRef      = useRef(null)
  const uberDragJustDoneRef = useRef(false)
  const uberPrevGroupRef    = useRef(null)
  const [uberEditSnappedPos, setUberEditSnappedPos] = useState(null)
  // InfoWindow open for a static (non-edit) Uber PE override marker.
  const [staticUberIw, setStaticUberIw] = useState(null)

  // Derive the target position for the active edit-mode marker.
  const uberEditGroupNumber = state.uberPeEditMode
  const uberEditTarget = uberEditGroupNumber != null
    ? (state.uberMeetingPointOverrides[uberEditGroupNumber] ?? state.chosenMeetingPoint)
    : null

  // Animation effect — runs when the target position or active group changes.
  useEffect(() => {
    if (uberEditRafRef.current) {
      cancelAnimationFrame(uberEditRafRef.current)
      uberEditRafRef.current = null
    }

    if (!uberEditTarget) {
      uberEditPosRef.current = null
      setUberEditSnappedPos(null)
      return
    }

    const target       = { lat: uberEditTarget.lat, lng: uberEditTarget.lng }
    const groupChanged = uberPrevGroupRef.current !== uberEditGroupNumber
    uberPrevGroupRef.current = uberEditGroupNumber

    // Skip animation for: first appearance, group switch, or after a drag.
    const instant = !uberEditPosRef.current || groupChanged || uberDragJustDoneRef.current
    uberDragJustDoneRef.current = false

    if (instant ||
        (uberEditPosRef.current?.lat === target.lat &&
         uberEditPosRef.current?.lng === target.lng)) {
      uberEditPosRef.current = target
      setUberEditSnappedPos(target)
      return
    }

    // Ease-out-cubic over 1500 ms — same parameters as StaffMarkers.
    const start    = { ...uberEditPosRef.current }
    const t0       = performance.now()
    const DURATION = 1500
    const ease     = (t) => 1 - Math.pow(1 - t, 3)

    function step(now) {
      const progress = Math.min((now - t0) / DURATION, 1)
      const e        = ease(progress)
      const current  = {
        lat: start.lat + (target.lat - start.lat) * e,
        lng: start.lng + (target.lng - start.lng) * e,
      }
      uberEditPosRef.current = current
      if (uberEditMarkerRef.current) {
        uberEditMarkerRef.current.position = current
      }
      if (progress < 1) {
        uberEditRafRef.current = requestAnimationFrame(step)
      } else {
        uberEditRafRef.current = null
        setUberEditSnappedPos({ ...current })
      }
    }

    uberEditRafRef.current = requestAnimationFrame(step)
    return () => {
      if (uberEditRafRef.current) {
        cancelAnimationFrame(uberEditRafRef.current)
        uberEditRafRef.current = null
      }
    }
  }, [uberEditTarget?.lat, uberEditTarget?.lng, uberEditGroupNumber]) // eslint-disable-line react-hooks/exhaustive-deps

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
        car_passengers:    [],
        uber_passengers:   [],
        pickup_passengers: [],
        pickup_place:      null,
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

  // ── Manual PEA map click ─────────────────────────────────────────────────
  // When manualPeaMode is true (step 2), every map click is intercepted.
  // We check proximity to the direct-route polyline (home→event, the red line);
  // clicks beyond 2000 m from it are silently ignored.
  const handleMapClickPea = useCallback(async (event) => {
    if (!state.manualPeaMode || state.currentStep !== 2) return
    if (!event.detail?.latLng) return

    const { lat, lng } = event.detail.latLng
    const clickedPoint = { lat, lng }

    const directPolyline = state.driverRoutes?.direct_route?.encoded_polyline
    let tooFar = false
    if (directPolyline) {
      const dist = distanceToPolylineMetres(clickedPoint, directPolyline)
      if (dist > 2000) return   // silently ignore clicks far from route
      if (dist > 500)  tooFar = true
    }

    // Show InfoWindow immediately with loading state, then fetch place info.
    setManualPeaInfo({ lat, lng, loading: true, tooFar, name: null, address: null, primary_type: null, opening_hours: [], staff_metrics: [] })

    // Derive assigned_roles from the frescos result (same pattern as doValidate).
    const staff          = state.staffWithCoords ?? []
    const assignedNames  = state.frescosResult?.assigned_names ?? []
    const assignedRoles  = assignedNames.map((name) => {
      const emp = staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)
      return emp?.Profesion ?? name
    })
    const meetingPoint = state.meetingPoint

    try {
      const info = await peaPlaceInfo(lat, lng, assignedRoles, meetingPoint.lat, meetingPoint.lng)
      setManualPeaInfo({ ...info, loading: false, tooFar })
    } catch {
      setManualPeaInfo({ lat, lng, loading: false, tooFar, name: null, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, primary_type: null, opening_hours: [], staff_metrics: [], error: 'No se pudo obtener info del lugar.' })
    }
  }, [state.manualPeaMode, state.currentStep, state.driverRoutes, state.staffWithCoords, state.frescosResult, state.meetingPoint])

  // When the user confirms a manually clicked PEA point.
  const handleConfirmManualPea = useCallback(() => {
    if (!manualPeaInfo || manualPeaInfo.loading) return
    dispatch({
      type:    ACTIONS.SET_CHOSEN_MEETING_POINT,
      payload: {
        name:    manualPeaInfo.name ?? 'PEA seleccionado manualmente',
        address: manualPeaInfo.address,
        lat:     manualPeaInfo.lat,
        lng:     manualPeaInfo.lng,
      },
    })
    dispatch({ type: ACTIONS.SET_MANUAL_PEA_MODE, payload: false })
    setManualPeaInfo(null)
  }, [manualPeaInfo, dispatch])

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
            cursor: (state.manualPickupMode && state.currentStep === 3) ||
                    (state.manualPeaMode    && state.currentStep === 2)
              ? 'crosshair' : undefined,
          }}
          onClick={
            (state.manualPickupMode && state.currentStep === 3) ? handleMapClick :
            (state.manualPeaMode    && state.currentStep === 2) ? handleMapClickPea :
            undefined
          }
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
                background="#7B1FA2"
                borderColor="#ffffff"
                glyphColor="#ffffff"
                scale={1.4}
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
          {/* Manual PEA InfoWindow — shown when user clicks during PEA mode */}
          {manualPeaInfo && (
            <InfoWindow
              position={{ lat: manualPeaInfo.lat, lng: manualPeaInfo.lng }}
              onCloseClick={() => setManualPeaInfo(null)}
              shouldFocus={false}
            >
              <div style={{ minWidth: 200, maxWidth: 280, fontFamily: 'sans-serif' }}>
                {manualPeaInfo.loading ? (
                  <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>Cargando…</p>
                ) : (
                  <>
                    {manualPeaInfo.name && (
                      <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px', color: '#111827' }}>
                        {manualPeaInfo.name}
                      </p>
                    )}
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.4 }}>
                      {manualPeaInfo.address}
                    </p>
                    {manualPeaInfo.opening_hours?.length > 0 && (
                      <p style={{ fontSize: 11, color: '#374151', margin: '0 0 6px' }}>
                        {manualPeaInfo.opening_hours[0]}
                      </p>
                    )}
                    {manualPeaInfo.tooFar && (
                      <p style={{ fontSize: 11, color: '#b45309', margin: '0 0 6px', background: '#fffbeb', padding: '4px 6px', borderRadius: 4 }}>
                        ⚠ Este punto está lejos de la ruta directa.
                      </p>
                    )}
                    {/* Per-employee transit savings */}
                    {manualPeaInfo.staff_metrics?.length > 0 && (
                      <div style={{ margin: '0 0 8px' }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
                          Ahorro estimado por empleado:
                        </p>
                        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                          <tbody>
                            {manualPeaInfo.staff_metrics.map((m) => (
                              <tr key={m.employee_name}>
                                <td style={{ paddingRight: 6, color: '#374151' }}>{m.employee_name}</td>
                                <td style={{ color: m.time_saved_min >= 0 ? '#15803d' : '#dc2626', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {m.time_saved_min >= 0 ? `−${m.time_saved_min} min` : `+${Math.abs(m.time_saved_min)} min`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {manualPeaInfo.error && (
                      <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 8px' }}>
                        {manualPeaInfo.error}
                      </p>
                    )}
                    <button
                      onClick={handleConfirmManualPea}
                      style={{
                        width:        '100%',
                        padding:      '7px 12px',
                        background:   '#FF6D00',
                        color:        '#fff',
                        border:       'none',
                        borderRadius: 6,
                        fontSize:     12,
                        fontWeight:   600,
                        cursor:       'pointer',
                      }}
                    >
                      Elegir como PEA
                    </button>
                  </>
                )}
              </div>
            </InfoWindow>
          )}

          {/* ── Uber PE edit marker (draggable, appears when uberPeEditMode set) ── */}
          {/* Animated ease-out-cubic via uberEditSnappedPos + direct position     */}
          {/* mutations on uberEditMarkerRef.  After drag, animation is suppressed. */}
          {uberEditGroupNumber !== null && (uberEditSnappedPos ?? uberEditTarget) && (
            <AdvancedMarker
              ref={uberEditMarkerRef}
              position={uberEditSnappedPos ?? uberEditTarget}
              draggable={true}
              title={`PE personalizado — Uber ${uberEditGroupNumber}`}
              onDrag={(e) => {
                const p = e?.target?.position ?? e?.latLng
                if (p) {
                  uberDragPosRef.current = {
                    lat: typeof p.lat === 'function' ? p.lat() : p.lat,
                    lng: typeof p.lng === 'function' ? p.lng() : p.lng,
                  }
                }
              }}
              onDragEnd={(e) => {
                const p = e?.target?.position ?? e?.latLng ?? uberDragPosRef.current
                if (p) {
                  const lat = typeof p.lat === 'function' ? p.lat() : p.lat
                  const lng = typeof p.lng === 'function' ? p.lng() : p.lng
                  // Suppress animation for drag-caused position changes — the
                  // marker is already at the drag destination.
                  uberDragJustDoneRef.current = true
                  dispatch({
                    type:    ACTIONS.SET_UBER_MEETING_POINT,
                    payload: {
                      groupNumber: uberEditGroupNumber,
                      meetingPoint: {
                        name:    'PE personalizado',
                        address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                        lat,
                        lng,
                      },
                    },
                  })
                }
                // Do NOT clear uberPeEditMode — the marker stays draggable and
                // the edit form stays open until the user clicks "Listo" / "Cancelar".
                uberDragPosRef.current = null
              }}
            >
              <Pin
                background="#111827"
                borderColor="#ffffff"
                glyphColor="#ffffff"
                scale={1.2}
              />
            </AdvancedMarker>
          )}

          {/* ── Static Uber PE override markers (always visible, non-draggable) ── */}
          {/* One marker per group that has a custom meeting point, except for the  */}
          {/* group currently being edited (covered by the draggable marker above). */}
          {Object.entries(state.uberMeetingPointOverrides).map(([groupNumStr, pos]) => {
            const groupNum = Number(groupNumStr)
            if (groupNum === uberEditGroupNumber) return null
            return (
              <AdvancedMarker
                key={`uber-pe-static-${groupNum}`}
                position={{ lat: pos.lat, lng: pos.lng }}
                draggable={false}
                title={`PE — Uber ${groupNum}: ${pos.name || pos.address}`}
                onClick={() => setStaticUberIw(groupNum)}
              >
                <Pin
                  background="#111827"
                  borderColor="#ffffff"
                  glyphColor="#ffffff"
                />
              </AdvancedMarker>
            )
          })}

          {/* InfoWindow for a clicked static Uber PE marker */}
          {staticUberIw !== null && state.uberMeetingPointOverrides[staticUberIw] && (
            <InfoWindow
              position={{
                lat: state.uberMeetingPointOverrides[staticUberIw].lat,
                lng: state.uberMeetingPointOverrides[staticUberIw].lng,
              }}
              onCloseClick={() => setStaticUberIw(null)}
            >
              <div style={{ minWidth: 160, maxWidth: 220, fontFamily: 'sans-serif' }}>
                <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 2px', color: '#111827' }}>
                  PE — Uber {staticUberIw}
                </p>
                <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                  {state.uberMeetingPointOverrides[staticUberIw].name || ''}
                </p>
                <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                  {state.uberMeetingPointOverrides[staticUberIw].address}
                </p>
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
          pickupPassengers={assignLogic.pickupPassengers}
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
          uberAutoFilled={assignLogic.uberAutoFilled}
          onAutoFill={assignLogic.handleAutoFill}
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
