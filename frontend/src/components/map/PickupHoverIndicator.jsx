/**
 * PickupHoverIndicator.jsx
 * Shows a semi-transparent circle that snaps to the nearest route vertex as
 * the cursor moves, during manual pickup mode.
 *
 * Lives inside <Map> to access the Google Maps instance via useMap().
 * Everything is imperative — no React state — so mousemove events (which fire
 * at 60fps) do not trigger React re-renders.
 *
 * Performance:
 *   - Throttled to 50ms (≤20 checks/sec) via a Date.now() ref.
 *   - Decoded polyline cached in a ref; only re-decoded when vehicleId or
 *     vehicles change, not on every render.
 *   - O(n) nearest-vertex search where n ≤ ~400 polyline points — fast enough
 *     at 20/sec on any modern CPU.
 */

import { useEffect, useRef } from 'react'
import { useMap }            from '@vis.gl/react-google-maps'
import polyline              from '@mapbox/polyline'
import { useAppState }       from '../../state/appState'

const THROTTLE_MS    = 50
const MAX_SNAP_M     = 500    // clicks beyond this distance are not highlighted
const CIRCLE_RADIUS  = 100    // metres — visible at city zoom without overwhelming the map
const CIRCLE_COLOR   = '#7B1FA2'
const CIRCLE_OPACITY = 0.4

function haversineMetres(a, b) {
  const R    = 6_371_000
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLng = (b.lng - a.lng) * (Math.PI / 180)
  const sl   = Math.sin(dLat / 2)
  const sm   = Math.sin(dLng / 2)
  const h    = sl * sl + Math.cos(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * sm * sm
  return 2 * R * Math.asin(Math.sqrt(h))
}

export default function PickupHoverIndicator() {
  const map       = useMap()
  const { state } = useAppState()

  const circleRef      = useRef(null)
  const lastMoveRef    = useRef(0)
  const decodedPolyRef = useRef(null)

  const isActive  = !!(state.manualPickupMode?.active && state.currentStep === 3)
  const vehicleId = state.manualPickupMode?.vehicleId ?? null

  // Decode and cache the active vehicle's route polyline.
  // Only re-runs when pickup mode, vehicleId, or vehicles array changes.
  useEffect(() => {
    if (!isActive || !vehicleId) {
      decodedPolyRef.current = null
      return
    }
    const vehicle = state.vehicles.find((v) => v.id === vehicleId)
    const encoded = vehicle?.route?.encoded_polyline
    if (!encoded) {
      decodedPolyRef.current = null
      return
    }
    const raw = polyline.decode(encoded)   // [[lat, lng], ...]
    decodedPolyRef.current = raw.map(([lat, lng]) => ({ lat, lng }))
  }, [isActive, vehicleId, state.vehicles])

  // Attach / detach the mousemove listener; manage the circle overlay lifecycle.
  useEffect(() => {
    if (!map) return

    if (!isActive) {
      // Mode deactivated — remove indicator immediately.
      if (circleRef.current) {
        circleRef.current.setMap(null)
        circleRef.current = null
      }
      return
    }

    function onMouseMove(event) {
      const now = Date.now()
      if (now - lastMoveRef.current < THROTTLE_MS) return
      lastMoveRef.current = now

      const vertices = decodedPolyRef.current
      if (!vertices?.length || !event.latLng) return

      const cursor = { lat: event.latLng.lat(), lng: event.latLng.lng() }

      let minDist = Infinity
      let nearest = null
      for (const v of vertices) {
        const d = haversineMetres(cursor, v)
        if (d < minDist) { minDist = d; nearest = v }
      }

      if (!nearest || minDist > MAX_SNAP_M) {
        if (circleRef.current) circleRef.current.setVisible(false)
        return
      }

      if (!circleRef.current) {
        circleRef.current = new window.google.maps.Circle({
          center:       nearest,
          radius:       CIRCLE_RADIUS,
          fillColor:    CIRCLE_COLOR,
          fillOpacity:  CIRCLE_OPACITY,
          strokeWeight: 0,
          clickable:    false,
          map,
        })
      } else {
        circleRef.current.setCenter(nearest)
        circleRef.current.setVisible(true)
      }
    }

    const listener = map.addListener('mousemove', onMouseMove)

    return () => {
      window.google?.maps?.event.removeListener(listener)
      if (circleRef.current) {
        circleRef.current.setMap(null)
        circleRef.current = null
      }
    }
  }, [map, isActive])

  return null
}
