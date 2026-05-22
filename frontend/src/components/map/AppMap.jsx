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
 */

import { useMemo, useEffect, useRef, useState, useCallback, Fragment } from 'react'
import { Map, AdvancedMarker, Pin, InfoWindow, useMap } from '@vis.gl/react-google-maps'
import { ChevronLeft }                               from 'lucide-react'
import polyline                                      from '@mapbox/polyline'
import { useAppState, ACTIONS, VEHICLE_COLORS }       from '../../state/appState'
import { pickupPlaceInfo, recalculateRouteWithPickup, peaPlaceInfo, placeDetails } from '../../api/endpoints'
import { useStepTwo }                    from '../../hooks/useStepTwo'
import MapBoundsController               from './MapBoundsController'
import StaffMarkers                      from './StaffMarkers'
import RoutePolylines                    from './RoutePolylines'
import MeetingPointMarkers               from './MeetingPointMarkers'
import EventMarker                       from './EventMarker'
import PickupCandidateMarkers            from './PickupCandidateMarkers'
import PickupHoverIndicator              from './PickupHoverIndicator'
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
// Bounds computation
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
// Vehicle label helper
// ---------------------------------------------------------------------------

function vehicleLabel(v) {
  if (v.type === 'personal') {
    return v.vehicle_description && v.driver
      ? `${v.vehicle_description} de ${v.driver}`
      : v.vehicle_description ?? 'Vehículo personal'
  }
  return `Uber ${v.id.replace('uber_', '')}`
}

// ---------------------------------------------------------------------------
// DblClickGateway — native dblclick listener
// ---------------------------------------------------------------------------
// Must live inside <Map> to call useMap().  handlerRef.current is swapped on
// every render so the listener itself (registered once per map instance) always
// calls the latest handler without re-registering.

function DblClickGateway({ handlerRef }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const listener = map.addListener('dblclick', (nativeEvent) => {
      const handler = handlerRef.current
      if (!handler) return
      const latLng = nativeEvent.latLng?.toJSON()
      if (!latLng) return
      handler({ detail: { latLng, placeId: null } })
    })
    return () => google.maps.event.removeListener(listener)
  }, [map, handlerRef])
  return null
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
  // Shape: { lat, lng, name, address, types, opening_hours, nearby_places, loading,
  //          error, tooFar, source }
  // source: 'poi' (Method 1 — single click on POI) | 'dblclick' (Method 2 — double click)
  // null = no InfoWindow shown.
  const [manualPickupInfo, setManualPickupInfo] = useState(null)

  // Temporary marker placed on double-click during pickup mode.  { lat, lng } or null.
  const [dblClickMarker, setDblClickMarker] = useState(null)

  // Whether we're currently calling /recalculate-route-with-pickup.
  const [recalculating, setRecalculating] = useState(false)

  // Manual PEA mode — InfoWindow state for a point clicked during step 2.
  // Shape: { lat, lng, name, address, primary_type, opening_hours, staff_metrics, loading, error, tooFar }
  // null = no InfoWindow shown.
  const [manualPeaInfo, setManualPeaInfo] = useState(null)

  // Vehicle custom-PE InfoWindow — stores vehicle id when the user clicks a
  // black custom-PE marker.  null means no InfoWindow is shown.
  const [vehiclePeIw, setVehiclePeIw] = useState(null)

  // Pickup InfoWindow — stores vehicle id when the user clicks a pickup marker.
  const [pickupIw, setPickupIw] = useState(null)

  // Passed to DblClickGateway; swapped each render so the native listener
  // always calls the latest handler without re-registering.
  const dblClickHandlerRef = useRef(null)

  // Trigger automatic backend calls on the step 1→2 transition.
  useStepTwo()

  // Clear pickup InfoWindow and temp marker whenever pickup mode is deactivated.
  useEffect(() => {
    if (!state.manualPickupMode?.active) {
      setManualPickupInfo(null)
      setDblClickMarker(null)
    }
  }, [state.manualPickupMode?.active])

  const bounds = useMemo(
    () => computeBounds(state.staffWithCoords, state.driverRoutes, state.eventCoords),
    [state.staffWithCoords, state.driverRoutes, state.eventCoords],
  )

  // ── Route proximity check helper ─────────────────────────────────────────
  // Returns { tooFar, offRoute } for a clicked point against the active vehicle
  // route polyline.
  const checkRouteProximity = useCallback((clickedPoint) => {
    const vehicleId     = state.manualPickupMode?.vehicleId
    const vehicle       = state.vehicles.find((v) => v.id === vehicleId)
    const activePolyline = vehicle?.route?.encoded_polyline
    if (!activePolyline) return { tooFar: false, offRoute: false }
    const dist = distanceToPolylineMetres(clickedPoint, activePolyline)
    return {
      offRoute: dist > PICKUP_REJECT_M,
      tooFar:   dist > PICKUP_WARNING_M && dist <= PICKUP_REJECT_M,
    }
  }, [state.manualPickupMode, state.vehicles])

  // ── Method 1: single click on a Google Maps POI ───────────────────────────
  // When the user clicks a named POI (gas station, restaurant, etc.) the map
  // fires a click event that carries a placeId.  We intercept it, prevent the
  // default Google Maps InfoWindow, and show our own with place details.
  const handleMapClick = useCallback(async (event) => {
    if (!state.manualPickupMode?.active || state.currentStep !== 3) return

    // placeId is on the native event (event.detail for vis.gl wrappers).
    const placeId = event.detail?.placeId
    if (!placeId) return   // empty-area single clicks are handled by dblclick

    if (!event.detail?.latLng) return
    const { lat, lng } = event.detail.latLng

    // Prevent the default Google Maps POI InfoWindow.
    event.stop?.()
    event.detail?.stop?.()

    const clickedPoint = { lat, lng }
    const { tooFar, offRoute } = checkRouteProximity(clickedPoint)
    if (offRoute) return

    setDblClickMarker(null)
    setManualPickupInfo({
      lat, lng, loading: true, tooFar, source: 'poi',
      name: null, address: null, types: [], opening_hours: [], nearby_places: [],
    })

    try {
      const details = await placeDetails(placeId)
      // Use the place's own coordinates as the pickup point (more accurate than
      // the click location which may land on the POI icon, not its centre).
      const pickupLat = details.lat ?? lat
      const pickupLng = details.lng ?? lng
      setManualPickupInfo({ ...details, lat: pickupLat, lng: pickupLng, loading: false, tooFar, source: 'poi', nearby_places: [] })
    } catch {
      setManualPickupInfo({
        lat, lng, loading: false, tooFar, source: 'poi',
        name: null, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        types: [], opening_hours: [], nearby_places: [],
        error: 'No se pudo obtener info del lugar.',
      })
    }
  }, [state.manualPickupMode, state.currentStep, checkRouteProximity])

  // ── Method 2: double click on empty road ─────────────────────────────────
  // The user double-clicks a spot on the road (not on a POI).  We place a
  // temporary marker, reverse-geocode the point, and show nearby candidates.
  const handleMapDblClick = useCallback(async (event) => {
    if (!state.manualPickupMode?.active || state.currentStep !== 3) return
    if (!event.detail?.latLng) return

    const { lat, lng } = event.detail.latLng
    const clickedPoint = { lat, lng }

    const { tooFar, offRoute } = checkRouteProximity(clickedPoint)
    if (offRoute) return

    // Place temporary marker and show loading InfoWindow.
    setDblClickMarker({ lat, lng })
    setManualPickupInfo({
      lat, lng, loading: true, tooFar, source: 'dblclick',
      name: null, address: null, types: [], opening_hours: [], nearby_places: [],
    })

    try {
      const info = await pickupPlaceInfo(lat, lng)
      setManualPickupInfo({ ...info, loading: false, tooFar, source: 'dblclick' })
    } catch {
      setManualPickupInfo({
        lat, lng, loading: false, tooFar, source: 'dblclick',
        name: null, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        types: [], opening_hours: [], nearby_places: [],
        error: 'No se pudo obtener info del lugar.',
      })
    }
  }, [state.manualPickupMode, state.currentStep, checkRouteProximity])

  // Keep the ref current so DblClickGateway always invokes the latest handler.
  dblClickHandlerRef.current = (state.manualPickupMode?.active && state.currentStep === 3)
    ? handleMapDblClick
    : null

  // When the user confirms a manually selected pickup point.
  // pickupDataOverride can be passed when the user chooses a specific candidate
  // from the nearby-places list (Method 2), bypassing the InfoWindow's lat/lng.
  const handleConfirmManualPickup = useCallback(async (pickupDataOverride = null) => {
    const pickupData = pickupDataOverride ?? manualPickupInfo
    if (!pickupData || recalculating) return
    setRecalculating(true)

    const vehicleId = state.manualPickupMode?.vehicleId ?? 'personal'
    const vehicle   = state.vehicles.find((v) => v.id === vehicleId)
    if (!vehicle) { setRecalculating(false); return }

    let originCoords
    if (vehicleId === 'personal') {
      // Personal vehicle: use driver's home address as the route origin.
      const driver     = state.personalVehicle?.driver
      const driverName = driver ? `${driver.Nombre} ${driver.Apellido}` : null
      const override   = driverName ? state.coordinateOverrides[driverName] : null
      // detect-personal-vehicle does not geocode staff, so driver.coordinates is
      // not populated.  Look up the geocoded entry from staffWithCoords instead.
      const driverWithCoords = driverName
        ? state.staffWithCoords?.find((e) => `${e.Nombre} ${e.Apellido}` === driverName)
        : null
      originCoords = {
        lat: override?.lat ?? driverWithCoords?.coordinates?.lat,
        lng: override?.lng ?? driverWithCoords?.coordinates?.lng,
      }
    } else {
      // Uber vehicle: the journey starts at the vehicle's meeting point (PE).
      originCoords = { lat: vehicle.meeting_point.lat, lng: vehicle.meeting_point.lng }
    }

    const meetingPt = { lat: vehicle.meeting_point.lat, lng: vehicle.meeting_point.lng }
    const pickupPt  = { lat: pickupData.lat, lng: pickupData.lng }
    const baseRoutePolyline = vehicle.route?.encoded_polyline ?? ''

    try {
      const newRoute = await recalculateRouteWithPickup(
        originCoords, meetingPt, pickupPt, state.eventCoords, baseRoutePolyline,
      )

      // For the personal vehicle also keep state.driverRoutes in sync so that
      // any component still reading it (e.g. step-2 fallback preview) stays correct.
      if (vehicleId === 'personal') {
        const isPea = state.meetingPoint &&
          state.chosenMeetingPoint?.name !== state.meetingPoint?.name
        const updatedRoutes = isPea
          ? { ...state.driverRoutes, direct_route: { ...state.driverRoutes.direct_route, encoded_polyline: newRoute.encoded_polyline } }
          : { ...state.driverRoutes, base_route:   { ...state.driverRoutes.base_route,   encoded_polyline: newRoute.encoded_polyline, legs: [] } }
        dispatch({ type: ACTIONS.SET_DRIVER_ROUTES, payload: updatedRoutes })
      }

      // Store the pickup point and updated route on the vehicle.
      dispatch({
        type:    ACTIONS.SET_VEHICLE_PICKUP_POINT,
        payload: {
          vehicle_id: vehicleId,
          point: {
            place_name:    pickupData.name ?? pickupData.address,
            place_address: pickupData.address,
            lat:           pickupData.lat,
            lng:           pickupData.lng,
          },
        },
      })
      dispatch({
        type:    ACTIONS.SET_VEHICLE_ROUTE,
        payload: {
          vehicle_id: vehicleId,
          route: {
            encoded_polyline: newRoute.encoded_polyline,
            pickup_before_pe: newRoute.pickup_before_pe ?? null,
            leg_seconds:      newRoute.leg_seconds ?? null,
          },
        },
      })

      setDblClickMarker(null)
      dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: { active: false, vehicleId: null } })
      setManualPickupInfo(null)
    } catch {
      setManualPickupInfo((prev) => prev ? { ...prev, error: 'Error al recalcular la ruta.' } : prev)
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
      {showStep3Panels && <UnassignedPanel />}

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
          disableDoubleClickZoom={state.manualPickupMode?.active && state.currentStep === 3}
          style={{
            width:  '100%',
            height: '100%',
            cursor: (state.manualPickupMode?.active && state.currentStep === 3) ||
                    (state.manualPeaMode    && state.currentStep === 2)
              ? 'crosshair' : undefined,
          }}
          onClick={
            (state.manualPickupMode?.active && state.currentStep === 3) ? handleMapClick :
            (state.manualPeaMode    && state.currentStep === 2) ? handleMapClickPea :
            undefined
          }
        >
          {/* Registers a native dblclick listener on the map — always mounted so
              the listener is added once and kept alive; the ref gates it. */}
          <DblClickGateway handlerRef={dblClickHandlerRef} />

          <MapBoundsController bounds={bounds} />

          {state.staffWithCoords && (
            <StaffMarkers staff={state.staffWithCoords} />
          )}

          <RoutePolylines />

          {state.meetingPoint && state.currentStep >= 2 && (
            <MeetingPointMarkers />
          )}

          {state.staffWithCoords && <EventMarker />}

          {state.activePickupResult && <PickupCandidateMarkers />}

          <PickupHoverIndicator />

          {/* Temporary marker placed on double-click during pickup mode (Method 2) */}
          {dblClickMarker && state.manualPickupMode?.active && (
            <AdvancedMarker
              position={{ lat: dblClickMarker.lat, lng: dblClickMarker.lng }}
              title="Punto de pickup seleccionado"
            >
              <Pin
                background="#7B1FA2"
                borderColor="#ffffff"
                glyphColor="#ffffff"
                scale={1.0}
              />
            </AdvancedMarker>
          )}

          {/* Per-vehicle pickup markers — one for each vehicle that has a pickup point */}
          {state.currentStep >= 3 && state.vehicles
            .filter((v) => v.pickup?.point)
            .map((v) => {
              const pickupColor = (VEHICLE_COLORS[v.id] ?? VEHICLE_COLORS.uber_1).pickup
              const pt = v.pickup.point
              return (
                <Fragment key={`pickup-${v.id}`}>
                  <AdvancedMarker
                    position={{ lat: pt.lat, lng: pt.lng }}
                    title={`Pickup: ${pt.place_name}`}
                    onClick={() => setPickupIw(v.id)}
                  >
                    <Pin
                      background={pickupColor}
                      borderColor="#ffffff"
                      glyphColor="#ffffff"
                      scale={1.3}
                    />
                  </AdvancedMarker>

                  {pickupIw === v.id && (
                    <InfoWindow
                      position={{ lat: pt.lat, lng: pt.lng }}
                      onCloseClick={() => setPickupIw(null)}
                    >
                      <div style={{ minWidth: 160, maxWidth: 220, fontFamily: 'sans-serif' }}>
                        <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px', color: '#111827' }}>
                          {pt.place_name}
                        </p>
                        {pt.place_address && pt.place_address !== pt.place_name && (
                          <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px', lineHeight: 1.4 }}>
                            {pt.place_address}
                          </p>
                        )}
                        <button
                          onClick={() => {
                            dispatch({ type: ACTIONS.CLEAR_VEHICLE_PICKUP, payload: { vehicle_id: v.id } })
                            setPickupIw(null)
                          }}
                          style={{
                            width: '100%', padding: '6px 10px',
                            background: '#dc2626', color: '#fff',
                            border: 'none', borderRadius: 5,
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          Quitar pickup
                        </button>
                      </div>
                    </InfoWindow>
                  )}
                </Fragment>
              )
            })
          }

          {/* ── Custom vehicle PE markers ─────────────────────────────────── */}
          {/* One black pin per Uber vehicle whose meeting point was customised  */}
          {/* via the Sidebar geocode flow (custom_meeting_point === true).       */}
          {state.vehicles
            .filter(v => v.custom_meeting_point && v.meeting_point)
            .map(v => (
              <AdvancedMarker
                key={`vehicle-pe-${v.id}`}
                position={{ lat: v.meeting_point.lat, lng: v.meeting_point.lng }}
                title={`PE personalizado — ${vehicleLabel(v)}`}
                onClick={() => setVehiclePeIw(v.id)}
              >
                <Pin
                  background="#000000"
                  borderColor="#ffffff"
                  glyphColor="#ffffff"
                  scale={1.1}
                />
              </AdvancedMarker>
            ))
          }

          {/* InfoWindow for a clicked custom vehicle PE marker */}
          {vehiclePeIw !== null && (() => {
            const v = state.vehicles.find(veh => veh.id === vehiclePeIw)
            if (!v?.meeting_point) return null
            return (
              <InfoWindow
                position={{ lat: v.meeting_point.lat, lng: v.meeting_point.lng }}
                onCloseClick={() => setVehiclePeIw(null)}
              >
                <div style={{ minWidth: 160, maxWidth: 220, fontFamily: 'sans-serif' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 2px', color: '#111827' }}>
                    PE — {vehicleLabel(v)}
                  </p>
                  {v.meeting_point.name && (
                    <p style={{ fontSize: 11, color: '#374151', margin: '0 0 2px', lineHeight: 1.4 }}>
                      {v.meeting_point.name}
                    </p>
                  )}
                  <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                    {v.meeting_point.address}
                  </p>
                </div>
              </InfoWindow>
            )
          })()}

          {/* Manual pickup InfoWindow — shown for both Method 1 (POI click) and Method 2 (dblclick) */}
          {manualPickupInfo && (
            <InfoWindow
              position={{ lat: manualPickupInfo.lat, lng: manualPickupInfo.lng }}
              onCloseClick={() => {
                setManualPickupInfo(null)
                setDblClickMarker(null)
              }}
            >
              <div style={{ minWidth: 200, maxWidth: 280, fontFamily: 'sans-serif' }}>
                {manualPickupInfo.loading ? (
                  <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>Cargando…</p>
                ) : manualPickupInfo.source === 'poi' ? (
                  /* ── Method 1: POI single-click ── */
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
                      <details style={{ margin: '0 0 8px', fontSize: 11 }}>
                        <summary style={{ cursor: 'pointer', color: '#374151', userSelect: 'none' }}>
                          Ver horarios
                        </summary>
                        <div style={{ paddingTop: 4 }}>
                          {manualPickupInfo.opening_hours.map((h, i) => (
                            <p key={i} style={{ fontSize: 10, color: '#374151', margin: '2px 0', lineHeight: 1.4 }}>{h}</p>
                          ))}
                        </div>
                      </details>
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
                      onClick={() => handleConfirmManualPickup()}
                      disabled={recalculating}
                      style={{
                        width: '100%', padding: '7px 12px',
                        background: recalculating ? '#374151' : '#111827',
                        color: '#fff', border: 'none', borderRadius: 6,
                        fontSize: 12, fontWeight: 600,
                        cursor: recalculating ? 'default' : 'pointer',
                      }}
                    >
                      {recalculating ? 'Recalculando…' : 'Elegir como punto de pickup'}
                    </button>
                  </>
                ) : (
                  /* ── Method 2: double-click (empty road) ── */
                  <>
                    {/* Primary action: exact clicked point */}
                    <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px', color: '#111827', lineHeight: 1.4 }}>
                      📍 {manualPickupInfo.address
                            || `${manualPickupInfo.lat.toFixed(5)}, ${manualPickupInfo.lng.toFixed(5)}`}
                    </p>
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
                      onClick={() => handleConfirmManualPickup({ ...manualPickupInfo, name: 'Punto personalizado' })}
                      disabled={recalculating}
                      style={{
                        width: '100%', padding: '8px 12px',
                        background: recalculating ? '#374151' : '#111827',
                        color: '#fff', border: 'none', borderRadius: 6,
                        fontSize: 13, fontWeight: 600,
                        cursor: recalculating ? 'default' : 'pointer',
                        marginBottom: 12,
                      }}
                    >
                      {recalculating ? 'Recalculando…' : 'Elegir esta ubicación'}
                    </button>

                    {/* Divider with "Lugares cercanos" label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                      <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Lugares cercanos
                      </span>
                      <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                    </div>

                    {/* Secondary: nearby places or empty state */}
                    {manualPickupInfo.nearby_places?.length > 0 ? (
                      <div>
                        {manualPickupInfo.nearby_places.map((place, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              marginBottom: 6, padding: '5px 8px',
                              background: '#f9fafb', borderRadius: 5,
                              border: '1px solid #e5e7eb',
                            }}
                          >
                            <span style={{ flex: 1, fontSize: 12, color: '#111827', lineHeight: 1.3 }}>
                              {place.name ?? place.address}
                            </span>
                            <button
                              onClick={() => handleConfirmManualPickup(place)}
                              disabled={recalculating}
                              style={{
                                flexShrink: 0, padding: '4px 10px',
                                background: recalculating ? '#6b7280' : '#7B1FA2',
                                color: '#fff', border: 'none', borderRadius: 5,
                                fontSize: 11, fontWeight: 600,
                                cursor: recalculating ? 'default' : 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {recalculating ? '…' : 'Elegir'}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, textAlign: 'center' }}>
                        No se encontraron lugares cercanos
                      </p>
                    )}
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
        </Map>

        {/* Center-bottom card showing the chosen meeting point (step 3) */}
        {state.currentStep >= 3 && state.chosenMeetingPoint && (
          <MeetingPointCard />
        )}

        {/* Floating pickup mode banner — visible while manual pickup mode is active */}
        {state.manualPickupMode?.active && state.currentStep === 3 && (
          <div
            style={{
              position:        'absolute',
              top:             68,
              left:            '50%',
              transform:       'translateX(-50%)',
              zIndex:          20,
              background:      'rgba(17, 24, 39, 0.88)',
              color:           '#fff',
              padding:         '9px 16px',
              borderRadius:    8,
              fontSize:        12,
              fontWeight:      500,
              boxShadow:       '0 2px 10px rgba(0,0,0,0.28)',
              display:         'flex',
              alignItems:      'center',
              gap:             12,
              whiteSpace:      'nowrap',
              pointerEvents:   'auto',
            }}
          >
            <span>
              Click en un lugar para elegirlo como pickup, o doble click en la calle para buscar opciones.
            </span>
            <button
              onClick={() => dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: { active: false, vehicleId: null } })}
              style={{
                background:     'none',
                border:         'none',
                color:          '#93c5fd',
                cursor:         'pointer',
                fontSize:       12,
                textDecoration: 'underline',
                padding:        0,
                flexShrink:     0,
              }}
            >
              Cancelar
            </button>
          </div>
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
      {showStep3Panels && <AssignmentSummaryPanel />}

      {/* ── Step 4 overlays (position:fixed — independent of flex layout) ── */}
      {state.showModal  && <ConfirmationModal />}
      {state.showOutput && <FinalOutputBlocks />}
    </div>
  )
}
