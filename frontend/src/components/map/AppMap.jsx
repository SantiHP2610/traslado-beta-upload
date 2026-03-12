/**
 * AppMap.jsx
 * Full-screen Google Map canvas with all floating UI panels.
 *
 * Layout model:
 *   The outer div is position:relative and fills the viewport.
 *   <Map> fills it entirely (position:absolute via its own styles).
 *   Floating panels use position:absolute inside this same div so they
 *   layer over the map without affecting document flow or scroll.
 *   This is why panels must be siblings of <Map>, not children of it —
 *   the Maps JS API owns the DOM inside <Map> and appending arbitrary
 *   React nodes there would conflict with its internal rendering.
 *
 * ── Components inside <Map> ───────────────────────────────────────────────────
 * MapBoundsController  — renderless; calls map.fitBounds() when bounds change.
 * StaffMarkers         — one AdvancedMarker per geocoded employee.
 * RoutePolylines       — blue base route + red direct route (step 2+).
 * MeetingPointMarkers  — green PE + orange PEA candidate markers (step 2+).
 * All four use useMap() internally, so they must be descendants of <Map>.
 *
 * ── Floating panels outside <Map> ────────────────────────────────────────────
 * FrescosPanel  — van question and result summary (step 1+).
 * PeaPanel      — meeting-point selection guide and confirmation (step 2).
 * Both must be outside <Map> because the Maps JS API controls that DOM;
 * adding arbitrary React nodes there can cause rendering conflicts.
 *
 * ── Why bounds are computed here, not in child components ────────────────────
 * AppMap is the viewport owner.  Any component that renders geographic content
 * (markers, polylines) should not also control where the camera points — that
 * would be reaching outside its own concern.  AppMap aggregates all visible
 * content and computes a single bounding box that fits everything, then passes
 * it to MapBoundsController which calls fitBounds() once.
 *
 * ── Why APIProvider is NOT here ───────────────────────────────────────────────
 * See App.jsx.  Short version: APIProvider must outlive any map
 * unmount/remount cycle, so it lives at the app root.
 *
 * ── Why useStepTwo is called here ─────────────────────────────────────────────
 * useStepTwo triggers automatically on the step 1→2 transition.  AppMap is
 * the component that renders map content for every step, so it is the natural
 * place to call step-level hooks.  Keeping it here also means the hook fires
 * regardless of which panel or sub-component the user is looking at.
 */

import { useMemo, useEffect, useState }  from 'react'
import { Map, AdvancedMarker, Pin }      from '@vis.gl/react-google-maps'
import { ChevronLeft }                  from 'lucide-react'
import polyline                          from '@mapbox/polyline'
import { useAppState, ACTIONS }          from '../../state/appState'
import { useStepTwo }                    from '../../hooks/useStepTwo'
import MapBoundsController               from './MapBoundsController'
import StaffMarkers                      from './StaffMarkers'
import RoutePolylines                    from './RoutePolylines'
import MeetingPointMarkers               from './MeetingPointMarkers'
import EventMarker                       from './EventMarker'
import PickupCandidateMarkers            from './PickupCandidateMarkers'
import FrescosPanel                      from '../panels/FrescosPanel'
import PeaPanel                          from '../panels/PeaPanel'
import AssignmentPanel                   from '../panels/AssignmentPanel'
import PickupResultPanel                 from '../panels/PickupResultPanel'
import ConfirmationModal                 from '../panels/ConfirmationModal'
import FinalOutputBlocks                 from '../panels/FinalOutputBlocks'
import ConfigPanel, { GearButton }       from '../panels/ConfigPanel'

const BA_CENTER    = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 11

// ---------------------------------------------------------------------------
// Bounds computation
//
// Aggregates all visible geographic content so MapBoundsController can fit
// the viewport to show everything at once.
//
// Sources:
//   1. Staff home addresses (always present once geocoding completes).
//   2. Route endpoints — first and last decoded points from each encoded
//      polyline.  Decoding the full polyline here is acceptable because
//      useMemo only re-runs when driverRoutes changes (rare), and each
//      encoded string is at most a few hundred points.
//   3. Event venue coordinates — resolved by EventMarker and stored in
//      state.eventCoords.  Including the venue ensures the map always
//      shows where the event is happening, not just where staff live.
//
// Why only polyline endpoints, not all decoded points?
//   The intermediate points fall between the endpoints; a bounding box from
//   just the endpoints contains all intermediate points modulo road curvature.
//   In practice, fitting to endpoints plus markers gives a viewport that
//   includes the full route with small margin.
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

  // Staff home addresses
  if (staffWithCoords) {
    for (const emp of staffWithCoords) {
      if (emp.coordinates) points.push(emp.coordinates)
    }
  }

  // Route polyline endpoints
  if (driverRoutes) {
    points.push(...getRouteEndpoints(driverRoutes.base_route?.encoded_polyline))
    points.push(...getRouteEndpoints(driverRoutes.direct_route?.encoded_polyline))
  }

  // Event venue — keep it in frame so the user always sees the destination
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

  // Config panel visibility — purely local UI state, no global dispatch needed.
  const [showConfig, setShowConfig] = useState(false)

  // Trigger automatic backend calls when step 2 starts.
  // This hook watches currentStep and fires once on the 1→2 transition.
  useStepTwo()

  // ── Step 3: auto-assign driver ───────────────────────────────────────────
  // When the user confirms the meeting point and advances to step 3,
  // immediately initialise the assignments object with the driver.
  // The driver is the personal vehicle owner; they are green on the map from
  // the moment step 3 starts and cannot be reassigned by the user.
  // Guard on assignments === null so this only fires once (not on re-renders).
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

  return (
    // position:relative establishes the containing block for all absolutely
    // positioned children (the map canvas + the floating panels).
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>

      <Map
        defaultCenter={BA_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        mapId={mapId}
        gestureHandling="greedy"
        disableDefaultUI={false}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Renderless controller — calls fitBounds whenever bounds changes */}
        <MapBoundsController bounds={bounds} />

        {/* Staff home address pins — rendered from boot */}
        {state.staffWithCoords && (
          <StaffMarkers staff={state.staffWithCoords} />
        )}

        {/* Driver route polylines — rendered from step 2 once routes are loaded */}
        {state.driverRoutes && <RoutePolylines />}

        {/*
          Meeting point markers — rendered from step 2 onward.
          In step 2: all PE/PEA markers are shown for selection.
          In steps 3+: MeetingPointMarkers itself filters to show only the
          chosen marker (larger pin, white ring) so the manager always sees
          the confirmed meeting point while making and reviewing assignments.
        */}
        {state.meetingPoint && state.currentStep >= 2 && (
          <MeetingPointMarkers />
        )}

        {/*
          Event venue marker — shown once the map is ready (staffWithCoords set).
          EventMarker handles its own coordinate resolution: it checks state,
          then the route polyline, then falls back to the Geocoding API.
          The condition mirrors the spec: "only renders when staffWithCoords
          is not null (map is ready)".
        */}
        {state.staffWithCoords && <EventMarker />}

        {/*
          Pickup candidate markers — shown while the PickupResultPanel is open.
          Renders one amber pin (0.8×) per place_option so the manager can see
          all candidate venues on the map alongside the panel list.
          Cleared automatically when activePickupResult is set to null.
        */}
        {state.activePickupResult && <PickupCandidateMarkers />}

        {/*
          Pickup place marker — gold star shown at the confirmed pickup venue.
          Only rendered in step 3+ when the user has confirmed a pickup.
          Gold/yellow (#FFC107) matches the pickup employee's marker color so
          the venue and the employee are visually paired.
        */}
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

      {/*
        Floating panels are OUTSIDE <Map> so they don't conflict with the
        Maps JS API's DOM ownership.  They are inside the relative container
        so position:absolute works relative to the viewport-filling div.
      */}

      {/* Step 1: van question + result summary */}
      {state.excelData && <FrescosPanel />}

      {/* Step 2: meeting-point selection guide + confirmation */}
      {state.currentStep === 2 && <PeaPanel />}

      {/* Step 3: manual passenger assignment */}
      {state.currentStep === 3 && <AssignmentPanel />}

      {/* Step 3: pickup search results (shown on demand, any step) */}
      {state.activePickupResult && <PickupResultPanel />}

      {/* Step 4: confirmation modal — draggable, stays after confirm */}
      {state.showModal && <ConfirmationModal />}

      {/* Step 4: final output blocks — two draggable cards after confirmation */}
      {state.showOutput && <FinalOutputBlocks />}

      {/*
        "Volver atrás" button — bottom-left corner.
        Visible whenever there is a step to go back to (stepHistory has entries)
        and the final output is not displayed (user should use "Volver a editar"
        inside FinalOutputBlocks instead of this global back button at that stage).
      */}
      {state.stepHistory.length > 0 && !state.showOutput && (
        <button
          onClick={() => dispatch({ type: ACTIONS.STEP_BACK })}
          style={{
            position:       'absolute',
            bottom:         24,
            left:           16,
            zIndex:         10,
            pointerEvents:  'auto',
            display:        'flex',
            alignItems:     'center',
            gap:            4,
            padding:        '6px 12px',
            background:     '#ffffff',
            border:         'none',
            borderRadius:   8,
            boxShadow:      '0 2px 8px rgba(0,0,0,0.18)',
            fontSize:       13,
            fontWeight:     500,
            color:          '#374151',
            cursor:         'pointer',
          }}
        >
          <ChevronLeft size={15} />
          Volver atrás
        </button>
      )}

      {/* Gear icon — always visible, top-right corner, above all other panels */}
      <GearButton
        onClick={() => setShowConfig((v) => !v)}
        active={showConfig}
      />

      {/* Config panel — slides in from the right; z-index 50 sits above panels */}
      {showConfig && (
        <ConfigPanel onClose={() => setShowConfig(false)} />
      )}
    </div>
  )
}
