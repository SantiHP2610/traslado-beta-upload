/**
 * RoutePolylines.jsx
 * Draws one Google Maps Polyline per vehicle that has a route.
 *
 * ── Why imperative Google Maps Polyline, not a React component ───────────────
 * @vis.gl/react-google-maps v1.7.x does not ship a <Polyline> component.
 * The idiomatic pattern is to get the map instance via useMap() and manage
 * Polyline objects imperatively.  The ref-map + useEffect approach ensures:
 *   1. Polylines are created once and updated only when vehicle routes change.
 *   2. Cleanup (setMap(null)) runs before re-creation or on unmount, preventing
 *      orphaned overlays from accumulating on the canvas.
 *
 * ── Two rendering modes ───────────────────────────────────────────────────────
 * Step 2 (no vehicles yet): falls back to state.driverRoutes for the preview:
 *   BLUE  (base_route, opacity 1.0)  — home → PE → event
 *   RED   (direct_route, opacity 0.6) — home → event
 *
 * Step 3+ (vehicles populated): draws one polyline set per vehicle:
 *   Personal vehicle:
 *     PE scenario  → two-leg split: #F9D976 (home→PE) + #E8A317 (PE→event)
 *     PEA scenario → #FF6D00 single line
 *   Uber vehicles  → single line in VEHICLE_COLORS[vehicle.id].route, thinner
 *
 * ── Encoded polyline decoding ─────────────────────────────────────────────────
 * Google Routes API returns routes as encoded polylines.  @mapbox/polyline
 * decodes them into [[lat, lng], …] and we convert to {lat, lng} for the Maps API.
 */

import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import polyline from '@mapbox/polyline'
import { useAppState, VEHICLE_COLORS } from '../../state/appState'

const PERSONAL_STROKE = 4
const UBER_STROKE     = 3

function decodePath(encoded) {
  return polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }))
}

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
 * Splits a decoded polyline at the vertex closest to peCoords.
 * Returns [leg0, leg1] (home→PE, PE→event) or null if split is degenerate.
 */
function splitAtPE(points, peCoords) {
  if (!peCoords || points.length < 3) return null

  let minDist = Infinity
  let splitIdx = 0
  for (let i = 0; i < points.length; i++) {
    const d = haversineM(points[i], peCoords)
    if (d < minDist) { minDist = d; splitIdx = i }
  }

  if (splitIdx === 0 || splitIdx >= points.length - 1) return null
  return [points.slice(0, splitIdx + 1), points.slice(splitIdx)]
}

/**
 * Draws the step-2 preview from state.driverRoutes.
 * Returns an array of created Polyline objects.
 */
function drawStep2Preview(map, driverRoutes, chosenMeetingPoint, meetingPoint) {
  const lines = []
  const { base_route, direct_route } = driverRoutes

  if (!chosenMeetingPoint) {
    // Both routes visible: blue base + red direct
    lines.push(new google.maps.Polyline({
      path: decodePath(base_route.encoded_polyline),
      strokeColor: '#4285F4', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map,
    }))
    lines.push(new google.maps.Polyline({
      path: decodePath(direct_route.encoded_polyline),
      strokeColor: '#EA4335', strokeWeight: PERSONAL_STROKE, strokeOpacity: 0.6, map,
    }))
    return lines
  }

  const isPea = meetingPoint && chosenMeetingPoint.name !== meetingPoint.name

  if (!isPea) {
    // PE chosen: two-leg yellow split on base route
    const points = decodePath(base_route.encoded_polyline)
    const split  = splitAtPE(points, chosenMeetingPoint)
    if (split) {
      const [leg0, leg1] = split
      lines.push(new google.maps.Polyline({ path: leg0, strokeColor: '#F9D976', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map }))
      lines.push(new google.maps.Polyline({ path: leg1, strokeColor: '#E8A317', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map }))
    } else {
      lines.push(new google.maps.Polyline({ path: points, strokeColor: '#FBBC04', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map }))
    }
  } else {
    // PEA chosen: orange direct route
    lines.push(new google.maps.Polyline({
      path: decodePath(direct_route.encoded_polyline),
      strokeColor: '#FF6D00', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map,
    }))
  }
  return lines
}

/**
 * Draws a single vehicle's route polyline(s).
 * Returns an array of created Polyline objects.
 */
function drawVehicleRoute(map, vehicle, chosenMeetingPoint, meetingPoint) {
  const encoded = vehicle.route?.encoded_polyline
  if (!encoded) return []

  const lines = []

  if (vehicle.type === 'personal') {
    // Same two-scenario rendering as the step-2 preview, using vehicle.route
    // as the source (base route for PE, direct route for PEA).
    const isPea = meetingPoint && chosenMeetingPoint && chosenMeetingPoint.name !== meetingPoint.name

    if (!isPea) {
      // PE scenario: split at chosen meeting point
      const points = decodePath(encoded)
      const split  = splitAtPE(points, chosenMeetingPoint)
      if (split) {
        const [leg0, leg1] = split
        lines.push(new google.maps.Polyline({ path: leg0, strokeColor: '#F9D976', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map }))
        lines.push(new google.maps.Polyline({ path: leg1, strokeColor: '#E8A317', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map }))
      } else {
        lines.push(new google.maps.Polyline({ path: points, strokeColor: '#FBBC04', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map }))
      }
    } else {
      // PEA scenario: single orange line
      lines.push(new google.maps.Polyline({
        path: decodePath(encoded),
        strokeColor: '#FF6D00', strokeWeight: PERSONAL_STROKE, strokeOpacity: 1.0, map,
      }))
    }
  } else {
    // Uber vehicle: single line in its assigned color
    const color = (VEHICLE_COLORS[vehicle.id] ?? VEHICLE_COLORS.uber_1).route
    lines.push(new google.maps.Polyline({
      path: decodePath(encoded),
      strokeColor: color, strokeWeight: UBER_STROKE, strokeOpacity: 0.8, map,
    }))
  }

  return lines
}

export default function RoutePolylines() {
  const map       = useMap()
  const { state } = useAppState()

  // Map keyed by vehicle.id (or '_preview' for the step-2 fallback).
  // Each value is an array of google.maps.Polyline instances.
  const polylinesRef = useRef(new Map())

  useEffect(() => {
    // Clear all existing polylines before redrawing.
    polylinesRef.current.forEach((lines) => lines.forEach((p) => p.setMap(null)))
    polylinesRef.current = new Map()

    if (!map) return

    const vehiclesWithRoutes = state.vehicles.filter((v) => v.route?.encoded_polyline)

    if (vehiclesWithRoutes.length > 0) {
      // ── Step 3+: draw one polyline set per vehicle ─────────────────────
      for (const v of vehiclesWithRoutes) {
        const lines = drawVehicleRoute(map, v, state.chosenMeetingPoint, state.meetingPoint)
        if (lines.length > 0) polylinesRef.current.set(v.id, lines)
      }
    } else if (state.driverRoutes) {
      // ── Step 2 fallback: preview from driverRoutes ─────────────────────
      const lines = drawStep2Preview(
        map, state.driverRoutes, state.chosenMeetingPoint, state.meetingPoint,
      )
      if (lines.length > 0) polylinesRef.current.set('_preview', lines)
    }

    return () => {
      polylinesRef.current.forEach((lines) => lines.forEach((p) => p.setMap(null)))
      polylinesRef.current = new Map()
    }
  }, [map, state.vehicles, state.driverRoutes, state.chosenMeetingPoint, state.meetingPoint])

  // Renderless — all output is via the imperative Maps JS API.
  return null
}
