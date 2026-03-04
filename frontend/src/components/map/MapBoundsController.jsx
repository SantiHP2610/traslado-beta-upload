/**
 * MapBoundsController.jsx
 * Renderless component that calls map.fitBounds() when the bounds prop changes.
 *
 * Why is this a separate component rather than logic inside AppMap?
 *
 *   1. Separation of concerns.
 *      AppMap owns the map canvas (what it looks like).
 *      MapBoundsController owns the viewport position (where it looks).
 *      Keeping them separate means we can change the zoom-to-fit behaviour
 *      (e.g. add animation, change padding, debounce rapid updates) without
 *      touching any map rendering code.
 *
 *   2. Hook constraints.
 *      useMap() returns the google.maps.Map instance, but it only works
 *      inside the component tree rendered by a <Map> parent — the hook reads
 *      from the GoogleMapsContext that <Map> provides.  A controller
 *      component placed as a child of <Map> satisfies this constraint cleanly.
 *      If this logic lived in App.jsx (above <Map>), useMap() would return null.
 *
 *   3. Future extensibility.
 *      Other "imperative" map operations — setting heading, tilting,
 *      smoothly panning to a clicked marker — can each become their own
 *      controller component without growing AppMap into a god component.
 *
 * Why fitBounds padding?
 *   fitBounds() sets the viewport so that all four edges of the bounding box
 *   touch the edges of the map div.  Without padding, markers sitting exactly
 *   on the boundary are half-visible — their icon bleeds outside the visible
 *   area.  60px on all sides ensures every marker is fully visible and there
 *   is breathing room between the route extremes and the edge of the screen.
 */

import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

// Pixels of inset from each edge of the map div when fitting bounds.
// 60px is enough to clear standard 40px marker icons plus a visual margin.
const FIT_BOUNDS_PADDING = 60

/**
 * @param {object} props
 * @param {{north: number, south: number, east: number, west: number} | null} props.bounds
 *   LatLngBoundsLiteral to zoom to.  When null this component is a no-op.
 */
export default function MapBoundsController({ bounds }) {
  // useMap() returns the underlying google.maps.Map instance created by the
  // nearest ancestor <Map> component.  Returns null until the map is ready.
  const map = useMap()

  useEffect(() => {
    // Guard: wait until both the map instance and a real bounds object exist.
    if (!map || !bounds) return

    map.fitBounds(bounds, FIT_BOUNDS_PADDING)
  }, [map, bounds])

  // This component renders nothing — it only drives the map imperatively.
  return null
}
