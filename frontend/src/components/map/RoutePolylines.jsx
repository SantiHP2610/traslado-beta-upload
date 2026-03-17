/**
 * RoutePolylines.jsx
 * Draws the driver's base route and direct route as colored polylines on the map.
 *
 * ── Why imperative Google Maps Polyline, not a React component ───────────────
 * @vis.gl/react-google-maps v1.7.x does not ship a <Polyline> component.
 * The idiomatic pattern for drawing native Maps JS API objects in this library
 * is to get the map instance via useMap() and then manage the objects directly
 * with google.maps.Polyline.  The useEffect + ref approach ensures:
 *   1. Polylines are created once and updated only when routes change.
 *   2. Cleanup (setMap(null)) runs on unmount or before re-creation, preventing
 *      orphaned overlays from accumulating on the canvas.
 *
 * ── Route color convention ────────────────────────────────────────────────────
 * Before the user selects a meeting point (step 2, no choice yet):
 *   BLUE  (#4285F4, opacity 1.0) → base_route:   driver home → PE → event
 *   RED   (#EA4335, opacity 0.6) → direct_route: driver home → event
 *   Both routes are shown simultaneously so the user can see the difference.
 *
 * After PE is selected:
 *   YELLOW (#FBBC04) → base_route only; direct_route removed.
 *
 * After a PEA is selected:
 *   ORANGE (#FF6D00) → direct_route only; base_route removed.
 *
 * Why remove the unchosen route?
 *   Once the user commits to a meeting point, the alternative route creates
 *   visual noise and implies the decision is still open.  The single
 *   highlighted route reinforces the committed choice and keeps the map clean.
 *
 * The chosen route color becomes the "scenario color" and matches the color
 * of the chosen meeting-point marker and the assigned-to-car staff markers,
 * creating a consistent visual theme across all map elements.
 *
 * ── Why this component renders inside <Map> ───────────────────────────────────
 * useMap() only works inside the <Map> component tree — it reads from the
 * vis.gl MapContext that <Map> provides.  Any component calling useMap() must
 * therefore be a descendant of <Map>.
 *
 * ── Encoded polyline decoding ─────────────────────────────────────────────────
 * Google Routes API returns routes as encoded polylines (a compact ASCII
 * representation of a series of lat/lng pairs).  We use @mapbox/polyline to
 * decode them into [[lat, lng], …] arrays and then convert to the
 * { lat, lng } objects that google.maps.Polyline expects.
 */

import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import polyline from '@mapbox/polyline'
import { useAppState } from '../../state/appState'

// Stroke weight shared by both lines — thick enough to be clearly visible
// over the map background without obscuring street labels underneath.
const STROKE_WEIGHT = 4

/**
 * Decodes a Google-encoded polyline string and converts each point to the
 * { lat, lng } format that google.maps.Polyline.path expects.
 *
 * @param {string} encoded  Google encoded polyline string
 * @returns {{ lat: number, lng: number }[]}
 */
function decodePath(encoded) {
  // @mapbox/polyline.decode returns [[lat, lng], [lat, lng], ...]
  return polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }))
}

export default function RoutePolylines() {
  const map          = useMap()
  const { state }    = useAppState()
  const polylinesRef = useRef([])   // holds the live google.maps.Polyline objects

  useEffect(() => {
    // Nothing to draw without a map instance or route data.
    if (!map || !state.driverRoutes) return

    // ── Cleanup previous polylines ─────────────────────────────────────────
    // Setting map(null) removes the overlay from the map canvas.
    // This runs both when routes/choice changes and on unmount.
    polylinesRef.current.forEach((p) => p.setMap(null))
    polylinesRef.current = []

    const { base_route, direct_route } = state.driverRoutes

    // ── Determine which scenario is active ─────────────────────────────────
    // isPea: user chose a point with a different name than the original PE.
    // chosenScenarioColor: the "theme color" that also drives marker colors.
    const isPea = state.meetingPoint && state.chosenMeetingPoint?.name !== state.meetingPoint?.name
    const chosen = state.chosenMeetingPoint

    if (!chosen) {
      // ── No selection yet: show both routes ──────────────────────────────
      // Base route: BLUE, full opacity — the standard PE path.
      const baseLine = new google.maps.Polyline({
        path:          decodePath(base_route.encoded_polyline),
        strokeColor:   '#4285F4',
        strokeWeight:  STROKE_WEIGHT,
        strokeOpacity: 1.0,
        map,
      })
      // Direct route: RED, reduced opacity — the PEA/pickup corridor.
      // Lower opacity signals it is a reference path, not the primary route.
      const directLine = new google.maps.Polyline({
        path:          decodePath(direct_route.encoded_polyline),
        strokeColor:   '#EA4335',
        strokeWeight:  STROKE_WEIGHT,
        strokeOpacity: 0.6,
        map,
      })
      polylinesRef.current = [baseLine, directLine]

    } else if (!isPea) {
      // ── PE chosen: two-color base route (home→PE in dark yellow-orange,
      //               PE→event in yellow) when per-leg polylines are available.
      // Falls back to a single yellow line when leg data is absent.
      const legs = base_route.legs
      if (
        Array.isArray(legs) &&
        legs.length >= 2 &&
        legs[0]?.encoded_polyline &&
        legs[1]?.encoded_polyline
      ) {
        // Leg 0: driver home → PE (#F5A623 darker yellow-orange)
        const leg0 = new google.maps.Polyline({
          path:          decodePath(legs[0].encoded_polyline),
          strokeColor:   '#F5A623',
          strokeWeight:  STROKE_WEIGHT,
          strokeOpacity: 1.0,
          map,
        })
        // Leg 1: PE → event (#FBBC04 yellow — matches PE marker + staff marker color)
        const leg1 = new google.maps.Polyline({
          path:          decodePath(legs[1].encoded_polyline),
          strokeColor:   '#FBBC04',
          strokeWeight:  STROKE_WEIGHT,
          strokeOpacity: 1.0,
          map,
        })
        polylinesRef.current = [leg0, leg1]
      } else {
        // Fallback: single yellow polyline when leg data is not available.
        const baseLine = new google.maps.Polyline({
          path:          decodePath(base_route.encoded_polyline),
          strokeColor:   '#FBBC04',
          strokeWeight:  STROKE_WEIGHT,
          strokeOpacity: 1.0,
          map,
        })
        polylinesRef.current = [baseLine]
      }

    } else {
      // ── PEA chosen: orange direct route only ────────────────────────────
      // The base route disappears — the driver goes home → PEA → event,
      // which follows the direct corridor (not the base route via PE).
      const directLine = new google.maps.Polyline({
        path:          decodePath(direct_route.encoded_polyline),
        strokeColor:   '#FF6D00',
        strokeWeight:  STROKE_WEIGHT,
        strokeOpacity: 1.0,
        map,
      })
      polylinesRef.current = [directLine]
    }

    // Cleanup: called when the component unmounts or before the next effect run
    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null))
      polylinesRef.current = []
    }
  }, [map, state.driverRoutes, state.chosenMeetingPoint, state.meetingPoint])

  // Renderless — all output is via the imperative Maps JS API.
  return null
}
