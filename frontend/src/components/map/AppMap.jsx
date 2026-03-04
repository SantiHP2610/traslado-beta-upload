/**
 * AppMap.jsx
 * Full-screen Google Map canvas.  Computes the bounding box from geocoded
 * staff, passes it to MapBoundsController, and renders StaffMarkers.
 *
 * ── Responsibility split ──────────────────────────────────────────────────────
 * AppMap is the layout owner for everything map-related:
 *   - It decides the initial viewport (center, zoom).
 *   - It computes the bounding box that MapBoundsController acts on.
 *   - It decides which marker/overlay components are active.
 *
 * StaffMarkers renders the markers and their info cards but does NOT touch
 * the viewport — that would cross a concern boundary.  AppMap reads
 * staffWithCoords from global state and derives bounds here so the
 * calculation lives in one place and can be extended later to also include
 * route endpoints, meeting points, etc., without touching StaffMarkers.
 *
 * ── Why APIProvider is NOT here ───────────────────────────────────────────────
 * See App.jsx for the full explanation.  Short version: APIProvider must
 * outlive any map unmount/remount cycle, so it lives at the app root.
 *
 * ── Why mapId matters ─────────────────────────────────────────────────────────
 * A Map ID links the map instance to a custom style in Google Cloud Console
 * and is required to use AdvancedMarker.  Without it, AdvancedMarker falls
 * back silently to a basic pin but loses custom content and styling.
 */

import { useMemo } from 'react'
import { Map } from '@vis.gl/react-google-maps'
import { useAppState } from '../../state/appState'
import MapBoundsController from './MapBoundsController'
import StaffMarkers from './StaffMarkers'

const BA_CENTER   = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 11

/**
 * Derive a LatLngBoundsLiteral from a geocoded staff list.
 * Returns null when the list is empty or all coordinates are null.
 *
 * Why here and not in StaffMarkers?
 *   Bounds are a viewport concern, not a marker rendering concern.
 *   AppMap owns the viewport; StaffMarkers owns the pins.  Keeping the
 *   calculation here means we can later add route polyline endpoints,
 *   meeting point coordinates, etc., all in the same place.
 *
 * @param {object[]|null} staff
 * @returns {{north: number, south: number, east: number, west: number}|null}
 */
function computeBounds(staff) {
  if (!staff) return null

  const coords = staff
    .map((e) => e.coordinates)
    .filter(Boolean)  // drop null (geocoding failures)

  if (coords.length === 0) return null

  const lats = coords.map((c) => c.lat)
  const lngs = coords.map((c) => c.lng)

  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east:  Math.max(...lngs),
    west:  Math.min(...lngs),
  }
}

export default function AppMap() {
  const { state } = useAppState()
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined

  // useMemo avoids recomputing the bounds on every render — bounds only
  // change when the staff list itself changes (i.e. once, after geocoding).
  const bounds = useMemo(
    () => computeBounds(state.staffWithCoords),
    [state.staffWithCoords],
  )

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Map
        defaultCenter={BA_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        mapId={mapId}
        gestureHandling="greedy"
        disableDefaultUI={false}
        style={{ width: '100%', height: '100%' }}
      >
        {/* MapBoundsController is renderless — it calls map.fitBounds()
            imperatively when bounds changes.  Must be inside <Map> to
            access the map context via useMap(). */}
        <MapBoundsController bounds={bounds} />

        {/* StaffMarkers only renders once geocoding has completed.
            Rendering before staffWithCoords is ready would produce zero
            markers anyway, but the explicit guard avoids unnecessary
            iterations over an empty array on every render cycle. */}
        {state.staffWithCoords && (
          <StaffMarkers staff={state.staffWithCoords} />
        )}
      </Map>
    </div>
  )
}
