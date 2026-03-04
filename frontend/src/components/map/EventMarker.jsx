/**
 * EventMarker.jsx
 * Renders a black pin at the event venue with an InfoWindow showing event
 * details from the Excel data.
 *
 * ── How event coordinates are obtained ───────────────────────────────────────
 * The event venue address is in the Excel (direccion_evento + ciudad_evento)
 * but no API call currently returns the venue's lat/lng directly.  To avoid
 * an unnecessary geocoding call when the data is already available, this
 * component checks three sources in priority order:
 *
 *   1. state.eventCoords — already set in a previous render cycle.
 *      The first time we resolve the coordinates we write them to global state
 *      so subsequent renders (and AppMap's bounds computation) can reuse them
 *      without repeating the logic.
 *
 *   2. state.driverRoutes.direct_route.encoded_polyline — the direct route
 *      runs from the driver's home to the event venue; its last decoded point
 *      is the venue.  Decoding this is free (no API call) and the coordinates
 *      are exact to road-snap precision, which is more than enough for a pin.
 *      This source is available once step 2 has run.
 *
 *   3. Google Geocoding API (useMapsLibrary) — a direct geocode call made
 *      only when neither of the above is available.  This covers step 1, when
 *      driverRoutes is null but the map is already showing staff markers.
 *      We use the Geocoding library already loaded by APIProvider rather than
 *      a separate backend call, so no new endpoint is needed.
 *
 * ── Why eventCoords lives in global state, not local ─────────────────────────
 * AppMap's computeBounds() needs the event venue coordinate to include it in
 * the auto-fit bounding box.  If the coordinate lived only in local state here,
 * AppMap would have no way to access it without prop drilling.  Storing it in
 * global state lets AppMap read it directly from useAppState().
 *
 * ── Why this component renders inside <Map> ───────────────────────────────────
 * AdvancedMarker and InfoWindow use the MapContext provided by the <Map>
 * parent; they must be descendants of <Map> to render into the map canvas.
 * This component is therefore placed as a child of <Map> in AppMap.jsx.
 *
 * ── Why the marker is black ───────────────────────────────────────────────────
 * Color convention from CLAUDE.md:
 *   Blue  → driver's PE route and staff markers
 *   Red   → direct (PEA corridor) route
 *   Green → original PE marker
 *   Orange → PEA candidate markers
 * Black is the only unassigned high-contrast color, making the event venue
 * visually distinct from all other map overlays.
 */

import { useEffect, useState }              from 'react'
import { AdvancedMarker, InfoWindow, Pin,
         useMapsLibrary }                   from '@vis.gl/react-google-maps'
import polyline                             from '@mapbox/polyline'
import { useAppState, ACTIONS }             from '../../state/appState'
import { Card, CardContent }               from '@/components/ui/card'

// ---------------------------------------------------------------------------
// InfoWindow content
// ---------------------------------------------------------------------------

function EventInfoContent({ event }) {
  const address = `${event.direccion_evento}, ${event.ciudad_evento}`

  return (
    <Card className="min-w-[200px] max-w-[280px] shadow-none border-0">
      <CardContent className="p-3 space-y-1.5">

        {/* Venue title */}
        <p className="font-semibold text-sm leading-tight">Evento</p>

        {/* Full address */}
        <p className="text-xs">{address}</p>

        {/* Client company — shown only when present */}
        {event.empresa && (
          <p className="text-xs text-muted-foreground">{event.empresa}</p>
        )}

        {/* Date and start time */}
        <p className="text-xs text-muted-foreground">
          {event.fecha} · {event.hora_inicio}
        </p>

        {/* Venue description — shown only when present */}
        {event.descripcion_locacion && (
          <p className="text-xs text-muted-foreground italic">
            {event.descripcion_locacion}
          </p>
        )}

        {/*
          Observaciones is a list of strings (split from the Excel on literal \n).
          Each item gets its own <p> so the original line breaks are preserved.
          Joining them into a single string would collapse distinct notes into
          one unreadable blob.
        */}
        {event.observaciones && event.observaciones.length > 0 && (
          <div className="pt-0.5 space-y-0.5 border-t border-border">
            {event.observaciones.map((obs, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {obs}
              </p>
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EventMarker() {
  const { state, dispatch } = useAppState()

  // useMapsLibrary loads the Google Maps Geocoding library on demand.
  // Returns null until the library script is ready; the hook re-renders
  // the component once the library becomes available so the useEffect below
  // fires again with a non-null value.
  const geocodingLib = useMapsLibrary('geocoding')

  // Controls which element (if any) has its InfoWindow open.
  // Local state — no other component needs to know whether this InfoWindow
  // is open; it is pure transient UI state.
  const [isOpen, setIsOpen] = useState(false)

  // ── Coordinate resolution ──────────────────────────────────────────────────
  useEffect(() => {
    // ── Priority 1: already resolved ────────────────────────────────────────
    // If eventCoords is already in state (from a previous render or geocode
    // call), do nothing.  This guard is the "check if coordinates are already
    // available" requirement — we only proceed to geocoding when necessary.
    if (state.eventCoords) return

    // ── Priority 2: derive from route polyline (free, no API call) ───────────
    // Once the driver's routes are loaded (step 2), the last decoded point
    // of the direct route (home → event) is the event venue.  This reuses
    // data already fetched without making a new request.
    if (state.driverRoutes?.direct_route?.encoded_polyline) {
      const decoded = polyline.decode(
        state.driverRoutes.direct_route.encoded_polyline,
      )
      if (decoded.length > 0) {
        const [lat, lng] = decoded[decoded.length - 1]
        dispatch({ type: ACTIONS.SET_EVENT_COORDS, payload: { lat, lng } })
        return
      }
    }

    // ── Priority 3: Google Geocoding API ─────────────────────────────────────
    // Fall back to a direct geocode call only when neither of the above
    // sources is available (typical during step 1, before routes are fetched).
    // We use the Geocoding library already loaded by APIProvider — no new
    // backend endpoint is needed.
    if (!geocodingLib || !state.excelData) return

    const event   = state.excelData.event
    const address = `${event.direccion_evento}, ${event.ciudad_evento}`

    const geocoder = new geocodingLib.Geocoder()
    geocoder.geocode({ address }, (results, status) => {
      // The callback may fire after the component unmounts in StrictMode's
      // double-invoke; dispatching to global state is always safe regardless.
      if (status === 'OK' && results?.length > 0) {
        const loc = results[0].geometry.location
        dispatch({
          type:    ACTIONS.SET_EVENT_COORDS,
          payload: { lat: loc.lat(), lng: loc.lng() },
        })
      }
    })
  }, [state.eventCoords, state.driverRoutes, geocodingLib, state.excelData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guard: don't render until coordinates are resolved ───────────────────
  // The marker returns null while geocoding is in flight.  This is preferable
  // to rendering at (0, 0) or crashing on a null position.
  if (!state.eventCoords || !state.excelData) return null

  const event = state.excelData.event

  return (
    <>
      {/*
        Black pin distinguishes the event venue from all other map overlays
        (staff = blue, PE = green, PEA = orange, routes = blue/red).
        title is the tooltip shown on desktop hover.
      */}
      <AdvancedMarker
        position={state.eventCoords}
        title="Evento"
        onClick={() => setIsOpen((v) => !v)}
      >
        <Pin
          background="#1a1a1a"
          borderColor="#000000"
          glyphColor="#ffffff"
        />
      </AdvancedMarker>

      {isOpen && (
        <InfoWindow
          position={state.eventCoords}
          // pixelOffset shifts the card above the pin so it doesn't overlap it.
          pixelOffset={[0, -40]}
          onCloseClick={() => setIsOpen(false)}
          shouldFocus={false}
        >
          <EventInfoContent event={event} />
        </InfoWindow>
      )}
    </>
  )
}
