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

import { useMemo, useEffect, useState }  from 'react'
import { Map, AdvancedMarker, Pin }      from '@vis.gl/react-google-maps'
import { ChevronLeft }                   from 'lucide-react'
import polyline                          from '@mapbox/polyline'
import { useAppState, ACTIONS }          from '../../state/appState'
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
          style={{ width: '100%', height: '100%' }}
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
