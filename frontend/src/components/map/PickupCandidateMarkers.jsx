/**
 * PickupCandidateMarkers.jsx
 * Renders candidate pickup venue markers on the map while the PickupResultPanel
 * is open (state.activePickupResult is set).
 *
 * ── Why these markers live inside <Map> ──────────────────────────────────────
 * AdvancedMarker and InfoWindow from @vis.gl/react-google-maps require a Maps
 * JS API context that is only available to descendants of <Map>.  The sibling
 * PickupResultPanel (a floating div outside <Map>) cannot host them.
 * PickupCandidateMarkers is imported in AppMap and placed inside <Map>.
 *
 * ── Color and scale ──────────────────────────────────────────────────────────
 * Markers use #FFC107 amber at 0.8× scale.  Same colour family as the confirmed
 * pickup star so the user recognises them as "pickup candidates", but visually
 * smaller so they don't compete with staff markers.
 *
 * ── Lifecycle ────────────────────────────────────────────────────────────────
 * Rendered only when activePickupResult has a candidate with place_options.
 * When the panel is dismissed (activePickupResult cleared) or a pickup is
 * confirmed, the markers vanish automatically because the parent condition
 * in AppMap re-evaluates.  No manual cleanup needed.
 */

import { useState }                          from 'react'
import { AdvancedMarker, InfoWindow, Pin }   from '@vis.gl/react-google-maps'
import { useAppState }                       from '../../state/appState'

export default function PickupCandidateMarkers() {
  const { state }  = useAppState()
  const [openIdx, setOpenIdx] = useState(null)

  const candidate = state.activePickupResult?.result?.pickup_candidate
  const places    = candidate?.place_options ?? []

  if (places.length === 0) return null

  return (
    <>
      {places.map((place, i) => (
        // span wrapper gives React a stable DOM node for the key; AdvancedMarker
        // needs a single root element, and span is semantically neutral here.
        <span key={`pickup-candidate-${i}-${place.lat}-${place.lng}`}>
          <AdvancedMarker
            position={{ lat: place.lat, lng: place.lng }}
            title={place.place_name}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          >
            <Pin
              background="#FFC107"
              borderColor="#e6a800"
              glyphColor="#1a1a1a"
              scale={0.8}
            />
          </AdvancedMarker>

          {openIdx === i && (
            <InfoWindow
              position={{ lat: place.lat, lng: place.lng }}
              pixelOffset={[0, -30]}
              onCloseClick={() => setOpenIdx(null)}
              shouldFocus={false}
            >
              {/*
                Inline styles used here because the InfoWindow renders in an
                isolated Google Maps DOM context — Tailwind class names are
                not guaranteed to be available inside the InfoWindow subtree.
              */}
              <div style={{ maxWidth: 220, padding: '4px 2px', fontFamily: 'inherit' }}>
                <p style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>
                  {place.place_name}
                </p>
                {place.place_address && (
                  <p style={{ fontSize: 11, color: '#555', marginBottom: 4, lineHeight: 1.4 }}>
                    {place.place_address}
                  </p>
                )}
                {(place.opening_hours ?? []).length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {place.opening_hours.map((line, j) => (
                      <li key={j} style={{ fontSize: 10, color: '#777', lineHeight: 1.5 }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </InfoWindow>
          )}
        </span>
      ))}
    </>
  )
}
