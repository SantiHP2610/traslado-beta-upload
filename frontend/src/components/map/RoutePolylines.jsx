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

/**
 * Haversine distance in metres between two {lat, lng} points.
 * Used to locate the closest polyline vertex to the meeting point.
 */
function haversineM(a, b) {
  const R    = 6_371_000
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLng = (b.lng - a.lng) * (Math.PI / 180)
  const s    = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * (Math.PI / 180)) *
    Math.cos(b.lat * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Splits a decoded polyline at the vertex closest to `peCoords`.
 * Returns [leg0Points, leg1Points] where leg0 = home→PE, leg1 = PE→event.
 * Returns null if a valid split index cannot be found.
 *
 * @param {{ lat: number, lng: number }[]} points  Decoded polyline vertices
 * @param {{ lat: number, lng: number }}   peCoords Meeting-point coordinates
 * @returns {[Array, Array] | null}
 */
function splitAtPE(points, peCoords) {
  if (!peCoords || points.length < 3) return null

  let minDist = Infinity
  let splitIdx = 0
  for (let i = 0; i < points.length; i++) {
    const d = haversineM(points[i], peCoords)
    if (d < minDist) { minDist = d; splitIdx = i }
  }

  // Reject degenerate splits (split at very start or very end of route).
  if (splitIdx === 0 || splitIdx >= points.length - 1) return null

  // Both legs share the split vertex so the two polylines connect cleanly.
  return [points.slice(0, splitIdx + 1), points.slice(splitIdx)]
}

/**
 * @param {{ [groupNumber: string]: string }} uberRoutes
 *   Encoded polylines for each Uber group's custom PE → event route,
 *   keyed by group number string.  Passed from AppMap where DirectionsService
 *   is called when uberMeetingPointOverrides change.
 */
export default function RoutePolylines({ uberRoutes = {} }) {
  const map          = useMap()
  const { state }    = useAppState()
  const polylinesRef = useRef([])   // holds the live google.maps.Polyline objects
  const uberPolylinesRef = useRef([]) // separate ref for Uber custom-PE route overlays

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
      // ── PE chosen: two-color base route ─────────────────────────────────
      // The Routes API puts the encoded polyline on the route, not per-leg,
      // so we split the full decoded path at the vertex closest to the PE.
      //   Leg 0 (home → PE):    #F9D976  light warm yellow
      //   Leg 1 (PE  → event):  #E8A317  deeper golden yellow
      // Falls back to single #FBBC04 when the split can't be determined.
      const peCoords = chosen   // chosen is state.chosenMeetingPoint (set above)
      const points   = decodePath(base_route.encoded_polyline)
      const split    = splitAtPE(points, peCoords)

      if (split) {
        const [leg0Points, leg1Points] = split
        const leg0 = new google.maps.Polyline({
          path:          leg0Points,
          strokeColor:   '#F9D976',   // light warm yellow: home → PE
          strokeWeight:  STROKE_WEIGHT,
          strokeOpacity: 1.0,
          map,
        })
        const leg1 = new google.maps.Polyline({
          path:          leg1Points,
          strokeColor:   '#E8A317',   // deeper golden yellow: PE → event
          strokeWeight:  STROKE_WEIGHT,
          strokeOpacity: 1.0,
          map,
        })
        polylinesRef.current = [leg0, leg1]
      } else {
        // Fallback: single yellow polyline when split is not possible.
        const baseLine = new google.maps.Polyline({
          path:          points,
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

  // ── Uber custom-PE → event route polylines ─────────────────────────────
  // Drawn as a separate set of overlays so their lifecycle is independent of
  // the main driver-route useEffect.  Near-black, slightly thinner than the
  // main route, so they read as secondary "branch" routes on the map.
  useEffect(() => {
    uberPolylinesRef.current.forEach((p) => p.setMap(null))
    uberPolylinesRef.current = []

    if (!map) return

    for (const encoded of Object.values(uberRoutes)) {
      if (!encoded) continue
      const line = new google.maps.Polyline({
        path:          decodePath(encoded),
        strokeColor:   '#1a1a1a',
        strokeWeight:  3,
        strokeOpacity: 0.7,
        map,
      })
      uberPolylinesRef.current.push(line)
    }

    return () => {
      uberPolylinesRef.current.forEach((p) => p.setMap(null))
      uberPolylinesRef.current = []
    }
  }, [map, uberRoutes])

  // Renderless — all output is via the imperative Maps JS API.
  return null
}
