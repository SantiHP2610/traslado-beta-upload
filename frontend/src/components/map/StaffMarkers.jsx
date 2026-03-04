/**
 * StaffMarkers.jsx
 * Renders one AdvancedMarker per geocoded employee, plus an InfoWindow
 * when the user clicks a marker.
 *
 * ── Why AdvancedMarker instead of the deprecated Marker ──────────────────────
 * google.maps.Marker is deprecated as of February 2024 and will eventually
 * be removed from the Maps JavaScript API.  AdvancedMarkerElement is its
 * replacement and offers several improvements:
 *   - Required for Map ID / custom styling (mapId must be set on the map).
 *   - Supports arbitrary HTML/React content as the pin body, enabling rich
 *     custom markers later (role icons, color-coded by assignment, etc.).
 *   - Better accessibility: natively keyboard-focusable and screen-reader
 *     friendly without extra configuration.
 * The vis.gl <AdvancedMarker> component wraps AdvancedMarkerElement and
 * integrates cleanly with React's render cycle.
 *
 * ── Why selectedEmployee is local state, not global ──────────────────────────
 * "Which marker is currently showing its info card" is pure UI state: it
 * affects only this component's rendering and has no meaning to any other
 * part of the app (the map bounds calculation, the frescos step, the PEA
 * evaluation, etc. don't care which info card is open).  Putting it in
 * global appState would pollute the business-state store with a transient
 * display concern.  Local useState is the right scope for state that is
 * created and destroyed within a single component's lifetime.
 *
 * ── Why bounds are computed in AppMap, not here ──────────────────────────────
 * AppMap is the layout owner: it decides how the map canvas is configured
 * (center, zoom, bounds).  If StaffMarkers computed bounds and called
 * fitBounds internally, it would be reaching outside its own concern
 * (rendering markers) to control a sibling/parent concern (viewport).
 * The clean separation is:
 *   AppMap    → computes bounds from staffWithCoords → passes to MapBoundsController
 *   StaffMarkers → renders markers → reports user interactions upward if needed
 */

import { useState } from 'react'
import { AdvancedMarker, InfoWindow, Pin } from '@vis.gl/react-google-maps'
import { Card, CardContent } from '@/components/ui/card'

/**
 * @param {object} props
 * @param {object[]} props.staff  Full geocoded staff list from state.staffWithCoords.
 *                                Each employee must have a "coordinates" key
 *                                ({ lat, lng }) or null if geocoding failed.
 */
export default function StaffMarkers({ staff }) {
  // selectedEmployee holds the full employee dict of the currently open info
  // card, or null when no card is open.  This is intentionally local —
  // see the comment block at the top of the file.
  const [selectedEmployee, setSelectedEmployee] = useState(null)

  return (
    <>
      {staff.map((employee) => {
        const coords = employee.coordinates
        // Skip employees whose address could not be geocoded — rendering a
        // marker at (0, 0) or crashing on null access would be worse than
        // silently omitting the marker and letting the error appear in the
        // employee data review step later.
        if (!coords) return null

        const fullName  = `${employee.Nombre} ${employee.Apellido}`
        const isSelected = selectedEmployee?.Nombre === employee.Nombre &&
                           selectedEmployee?.Apellido === employee.Apellido

        return (
          // key must be stable across renders.  Nombre+Apellido is the
          // canonical employee identifier used throughout the app.
          <AdvancedMarker
            key={fullName}
            position={{ lat: coords.lat, lng: coords.lng }}
            title={`${fullName} — ${employee.Profesion}`}
            onClick={() =>
              // Toggle: clicking the already-selected marker closes the card.
              setSelectedEmployee(isSelected ? null : employee)
            }
          >
            {/*
              Pin renders the standard teardrop shape with customisable colors.
              Blue (#4285F4) matches Google's own "default" blue and is used
              for all unassigned staff markers.  Later steps will re-color
              markers based on vehicle assignment (blue = PE car, red = PEA
              car, grey = Uber) by passing a different background prop.
            */}
            <Pin
              background="#4285F4"
              borderColor="#2a6dd9"
              glyphColor="#ffffff"
            />
          </AdvancedMarker>
        )
      })}

      {/*
        InfoWindow is rendered once, outside the marker loop, anchored to
        the selected marker.  Rendering it inside the loop would create N
        InfoWindow instances that all fight over visibility.  The anchor prop
        accepts a google.maps.marker.AdvancedMarkerElement, but vis.gl also
        supports passing position directly via the `position` prop, which is
        simpler here since we already have the coordinates.
      */}
      {selectedEmployee && selectedEmployee.coordinates && (
        <InfoWindow
          position={{
            lat: selectedEmployee.coordinates.lat,
            lng: selectedEmployee.coordinates.lng,
          }}
          // pixelOffset shifts the card upward so it doesn't overlap the
          // marker pin.  [0, -40] = 0px horizontal, 40px above anchor.
          pixelOffset={[0, -40]}
          onCloseClick={() => setSelectedEmployee(null)}
          shouldFocus={false}
        >
          {/*
            The InfoWindow renders its children inside a Google Maps overlay.
            We use a shadcn/ui Card so the info card matches the app's design
            system rather than Google's default white-box styling.
            The Card sits inside the InfoWindow's DOM portal — Tailwind classes
            work here because Vite processes them globally.
          */}
          <Card className="min-w-[180px] shadow-none border-0">
            <CardContent className="p-3 space-y-0.5">
              <p className="font-semibold text-sm leading-tight">
                {selectedEmployee.Nombre} {selectedEmployee.Apellido}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedEmployee.Profesion}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedEmployee.Direccion}, {selectedEmployee.Ciudad}
              </p>
            </CardContent>
          </Card>
        </InfoWindow>
      )}
    </>
  )
}
