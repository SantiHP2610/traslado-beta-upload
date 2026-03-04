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
 * BLUE  (#4285F4, opacity 1.0) → base_route:   driver home → PE → event
 *   "PE route": the standard path that passes through the staging point.
 *   Full opacity because this is the default / most important route to show.
 *
 * RED   (#EA4335, opacity 0.6) → direct_route: driver home → event
 *   "Direct route": used as the corridor for PEA and pickup-point search.
 *   Reduced opacity signals it is a reference path, not the primary route.
 *
 * This matches the color coding defined in CLAUDE.md:
 *   "PE route (chofer → PE → evento): BLUE"
 *   "PEA route (chofer → PEA → evento): RED"
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
    // This runs both when routes change and on unmount (cleanup function).
    polylinesRef.current.forEach((p) => p.setMap(null))
    polylinesRef.current = []

    // ── Base route: BLUE, full opacity ────────────────────────────────────
    // Driver home → PE → event.  The standard route shown to the user.
    const baseLine = new google.maps.Polyline({
      path:          decodePath(state.driverRoutes.base_route.encoded_polyline),
      strokeColor:   '#4285F4',
      strokeWeight:  STROKE_WEIGHT,
      strokeOpacity: 1.0,
      map,
    })

    // ── Direct route: RED, reduced opacity ────────────────────────────────
    // Driver home → event (no PE stop).  Used as the PEA/pickup corridor.
    // Reduced opacity signals it is a reference path, not the primary route.
    const directLine = new google.maps.Polyline({
      path:          decodePath(state.driverRoutes.direct_route.encoded_polyline),
      strokeColor:   '#EA4335',
      strokeWeight:  STROKE_WEIGHT,
      strokeOpacity: 0.6,
      map,
    })

    polylinesRef.current = [baseLine, directLine]

    // Cleanup: called when the component unmounts or before the next effect run
    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null))
      polylinesRef.current = []
    }
  }, [map, state.driverRoutes])

  // Renderless — all output is via the imperative Maps JS API.
  return null
}
