/**
 * AppMap.jsx
 * Full-screen Google Map rendered via @vis.gl/react-google-maps.
 *
 * This component is responsible for the map canvas only — it does not fetch
 * data or manage application state.  Those concerns live in hooks/ and
 * state/ respectively.  Keeping the map "dumb" means we can swap the
 * underlying map library without touching any business logic.
 *
 * Why is APIProvider NOT here?
 *   APIProvider loads the Google Maps JavaScript API script once and shares
 *   the loaded context with every child that calls useMap(), useMapsLibrary(),
 *   etc.  If it lived inside AppMap, and AppMap were ever unmounted and
 *   remounted (e.g. during a route change or modal toggle), the API would
 *   reload.  Instead it wraps the entire App in App.jsx so it is mounted once
 *   for the application lifetime, regardless of what renders inside it.
 *
 * Why mapId?
 *   A Map ID is a Google Cloud Console identifier that links the map instance
 *   to a custom style (colors, POI visibility, road labels, etc.) configured
 *   in the Cloud Console.  It is also required to use Advanced Markers — the
 *   modern replacement for the deprecated Marker API.  Without a mapId the
 *   map still works but falls back to the default Google style and cannot use
 *   Advanced Markers.  The value is kept in .env so it can differ between
 *   development and production environments without touching source code.
 */

import { Map } from '@vis.gl/react-google-maps'
import MapBoundsController from './MapBoundsController'

// Buenos Aires city center — a sensible starting position before any event
// data is loaded.  At zoom 11 the full urban area is visible, including the
// three fixed meeting points (North/South/West CABA).
const BA_CENTER = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 11

/**
 * AppMap renders the full-screen map canvas.
 *
 * @param {object} props
 * @param {{north: number, south: number, east: number, west: number} | null} props.bounds
 *   When provided, the map zooms to fit all points within the bounding box.
 *   Pass null to keep the default center / zoom.
 */
export default function AppMap({ bounds = null }) {
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined

  return (
    // The outer div constrains the map to exactly the viewport.
    // overflow-hidden prevents any scrollbar caused by the map canvas itself.
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Map
        defaultCenter={BA_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        mapId={mapId}
        // gestureHandling="greedy" lets the user scroll the map with a single
        // finger on touch devices without accidentally scrolling the page.
        gestureHandling="greedy"
        // Disable the default Google Maps UI controls we don't need.
        // We will add our own controls later as shadcn/ui components so they
        // match the app's design system.
        disableDefaultUI={false}
        style={{ width: '100%', height: '100%' }}
      >
        {/*
          MapBoundsController is a renderless child that calls fitBounds()
          on the underlying google.maps.Map instance when bounds changes.
          It must be a child of <Map> so it can access the map context via
          useMap() — the hook only works inside the Map component tree.
        */}
        <MapBoundsController bounds={bounds} />
      </Map>
    </div>
  )
}
