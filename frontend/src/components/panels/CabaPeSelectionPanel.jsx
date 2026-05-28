/**
 * CabaPeSelectionPanel.jsx
 * Step 2 panel shown after the manager decides to plan transport for a CABA event.
 *
 * Displays all 3 predefined meeting points (from state.allMeetingPoints) sorted
 * by travel time, and lets the manager choose one.  Choosing dispatches
 * SET_MEETING_POINT + SET_CHOSEN_MEETING_POINT, which triggers INIT_VEHICLES in
 * Sidebar and advances the flow to step 3.
 */

import { useAppState, ACTIONS } from '../../state/appState'

function formatDuration(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${meters} m`
}

function MeetingPointOption({ point, onSelect }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2.5 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight truncate">{point.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{point.address}</p>
        </div>
        <button
          onClick={() => onSelect(point)}
          className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Elegir
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>🚗 {formatDuration(point.duration_seconds)}</span>
        <span>{formatDistance(point.distance_meters)}</span>
      </div>
    </div>
  )
}

export function CabaPeSelectionPanel() {
  const { state, dispatch } = useAppState()

  const allPoints = state.allMeetingPoints
  if (!allPoints) return null

  const allSorted = [allPoints.recommended, ...(allPoints.alternatives ?? [])]

  function handleSelect(point) {
    dispatch({ type: ACTIONS.SET_MEETING_POINT,        payload: point })
    dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT, payload: point })
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
        {allSorted.map((pt, i) => (
          <div key={pt.name} className="relative">
            {i === 0 && (
              <span className="absolute -top-1.5 right-2 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 z-10">
                Recomendado
              </span>
            )}
            <MeetingPointOption point={pt} onSelect={handleSelect} />
          </div>
        ))}
      </div>
    </div>
  )
}
