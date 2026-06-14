/**
 * CabaPeSelectionPanel.jsx
 * Step 2 panel shown after the manager decides to plan transport for a CABA event.
 *
 * This is a PE RECOMMENDER only — it shows the 3 predefined options with badges
 * and lets the manager pick their preferred one.  Confirming dispatches only
 * SET_MEETING_POINT, which flips the Sidebar condition (line 1008) so PeaPanel
 * renders.  useStepTwo then fires, calculates driver routes + PEA candidates, and
 * the manager confirms from the map marker InfoWindow — same as the normal flow.
 *
 * Interaction model:
 *   - Click card  → visual selection + SET_HIGHLIGHTED_PE (map marker preview)
 *   - Click Elegir → SET_MEETING_POINT only + clear highlight → PeaPanel takes over
 */

import { useState } from 'react'
import { useAppState, ACTIONS } from '../../state/appState'

function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDuration(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function CabaPeSelectionPanel() {
  const { state, dispatch } = useAppState()
  const [selectedPe, setSelectedPe] = useState(null)

  const allPoints = state.allMeetingPoints
  if (!allPoints) return null

  const allSorted      = [allPoints.recommended, ...(allPoints.alternatives ?? [])]
  const staffWithCoords = (state.staffWithCoords ?? []).filter(e => e.coordinates)

  // Average haversine distance from each PE to geocoded employees
  const avgTeamDists = allSorted.map(pe => {
    if (!staffWithCoords.length) return null
    const sum = staffWithCoords.reduce(
      (s, e) => s + haversineKm(e.coordinates.lat, e.coordinates.lng, pe.lat, pe.lng),
      0,
    )
    return sum / staffWithCoords.length
  })

  const hasTeamData = avgTeamDists.some(d => d !== null)
  const closestToTeamIdx = !hasTeamData ? -1 : avgTeamDists.reduce(
    (minI, d, i) => (d !== null && (avgTeamDists[minI] === null || d < avgTeamDists[minI])) ? i : minI,
    0,
  )

  // PE closest to event = lowest duration_seconds (driving time, not straight-line distance).
  // Duration is more accurate than distance_meters for deciding which PE is "best" —
  // a farther PE might be faster due to road layout.
  const closestToEventIdx = allSorted.reduce(
    (minI, pe, i) =>
      pe.duration_seconds != null &&
      (allSorted[minI].duration_seconds == null || pe.duration_seconds < allSorted[minI].duration_seconds)
        ? i : minI,
    0,
  )

  function handleCardClick(pt) {
    setSelectedPe(pt)
    dispatch({
      type:    ACTIONS.SET_HIGHLIGHTED_PE,
      payload: { name: pt.name, lat: pt.lat, lng: pt.lng, address: pt.address },
    })
  }

  function handleConfirm(pt) {
    // SET_MEETING_POINT alone flips the Sidebar condition (isCaba && !meetingPoint → false)
    // so PeaPanel renders and useStepTwo calculates routes.  Do NOT set chosenMeetingPoint
    // here — that happens later when the manager confirms from the map marker InfoWindow.
    dispatch({ type: ACTIONS.SET_MEETING_POINT,  payload: pt })
    dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: null })
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm">Elegir punto de encuentro</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Seleccioná el PE más conveniente para este evento.
        </p>
      </div>

      <div className="space-y-2">
        {allSorted.map((pt, i) => {
          const isSelected      = selectedPe?.name === pt.name
          const isClosestEvent  = i === closestToEventIdx
          const isClosestTeam   = hasTeamData && i === closestToTeamIdx
          const avgDist         = avgTeamDists[i]
          const distKm          = pt.distance_meters != null
            ? (pt.distance_meters / 1000).toFixed(1)
            : null

          return (
            <div
              key={pt.name}
              onClick={() => handleCardClick(pt)}
              className={[
                'rounded-md border px-3 py-2.5 space-y-1.5 cursor-pointer transition-all',
                isSelected
                  ? 'border-l-4 border-blue-500 bg-blue-50'
                  : 'border-border bg-background hover:bg-muted/30',
              ].join(' ')}
            >
              {/* Recommendation badges */}
              {(isClosestEvent || isClosestTeam) && (
                <div className="flex flex-wrap gap-1">
                  {isClosestEvent && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      Recomendado — más cercano al evento
                    </span>
                  )}
                  {isClosestTeam && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      Más cercano al equipo
                    </span>
                  )}
                </div>
              )}

              {/* Name + address + confirm button (shown only when card is selected) */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{pt.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{pt.address}</p>
                </div>
                {isSelected && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleConfirm(pt) }}
                    className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Elegir
                  </button>
                )}
              </div>

              {/* Travel time and distance metrics */}
              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                {pt.duration_seconds != null && (
                  <span>🚗 {formatDuration(pt.duration_seconds)} desde CP</span>
                )}
                {distKm && (
                  <span>Distancia al evento: {distKm} km</span>
                )}
                {avgDist != null && (
                  <span>Distancia promedio del equipo: {avgDist.toFixed(1)} km</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!selectedPe && (
        <p className="text-xs text-muted-foreground text-center mt-1">
          Hacé click en un PE para seleccionarlo
        </p>
      )}
    </div>
  )
}
