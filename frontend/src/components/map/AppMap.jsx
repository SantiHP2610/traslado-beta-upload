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
 * ── Why bounds are computed here, not in StaffMarkers ────────────────────────
 * AppMap is the viewport owner.  StaffMarkers renders pins; it should not
 * also control where the camera points.  Keeping bounds computation here
 * means we can later extend it to include route endpoints, meeting points,
 * pickup candidates, etc., all in one place without coupling those concerns
 * to the marker component.
 *
 * ── Why APIProvider is NOT here ───────────────────────────────────────────────
 * See App.jsx.  Short version: APIProvider must outlive any map
 * unmount/remount cycle, so it lives at the app root.
 */

import { useMemo } from 'react'
import { Map } from '@vis.gl/react-google-maps'
import { useAppState } from '../../state/appState'
import MapBoundsController from './MapBoundsController'
import StaffMarkers from './StaffMarkers'
import FrescosPanel from '../panels/FrescosPanel'

const BA_CENTER    = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 11

function computeBounds(staff) {
  if (!staff) return null
  const coords = staff.map((e) => e.coordinates).filter(Boolean)
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

  const bounds = useMemo(
    () => computeBounds(state.staffWithCoords),
    [state.staffWithCoords],
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
        <MapBoundsController bounds={bounds} />

        {state.staffWithCoords && (
          <StaffMarkers staff={state.staffWithCoords} />
        )}
      </Map>

      {/*
        FrescosPanel is placed OUTSIDE <Map> but inside the relative container.
        It must be outside <Map> because:
          1. The Maps JS API controls the DOM inside <Map>; adding arbitrary
             React content there can cause conflicts.
          2. Panels need to receive pointer events independently of the map —
             a click on the panel should not also fire a map click event.
        It is always rendered (not gated on currentStep) because it shows
        the question on step 1 and the summary on step 2+.
        Only render once excelData is loaded so the event details are available.
      */}
      {state.excelData && <FrescosPanel />}
    </div>
  )
}
