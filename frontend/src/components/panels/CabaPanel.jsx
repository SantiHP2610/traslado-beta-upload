/**
 * CabaPanel.jsx
 * Step 2 panel shown when the event venue is inside CABA.
 *
 * Since CABA staff typically commute independently, this panel informs the
 * manager of the estimated return time and any safety warnings, then gives
 * them the option to plan transport anyway.
 */

import { useAppState, ACTIONS } from '../../state/appState'

// Adds minutes to an "HH:MM" string and returns the result as "HH:MM".
function addMinutes(timeStr, minutes) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':').map(Number)
  const total  = h * 60 + m + minutes
  const hh     = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const mm     = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function CabaPanel() {
  const { state, dispatch } = useAppState()

  const event            = state.excelData?.event ?? {}
  const horaInicio       = event.hora_inicio ?? null
  const durationHours    = event.event_duration_hours ?? 4
  const returnTime       = horaInicio ? addMinutes(horaInicio, durationHours * 60) : null
  const returnHour       = returnTime ? parseInt(returnTime.split(':')[0], 10) : null
  const nightWarning     = returnHour !== null && returnHour >= 23

  function handlePlanTransport() {
    dispatch({ type: ACTIONS.SET_CABA_DECISION_TO_TRANSPORT, payload: true })
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-base">🏙️</span>
        <h3 className="font-semibold text-sm">Evento en CABA</h3>
      </div>

      <p className="text-sm text-muted-foreground">
        El evento es en Ciudad Autónoma de Buenos Aires. El personal puede
        trasladarse por sus propios medios.
      </p>

      {/* Return time */}
      {returnTime && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Inicio del evento</span>
            <span className="font-medium">{horaInicio}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Duración estimada</span>
            <span className="font-medium">{durationHours} hs</span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1 mt-1">
            <span className="text-muted-foreground">Horario de regreso aprox.</span>
            <span className="font-semibold">{returnTime}</span>
          </div>
        </div>
      )}

      {/* Night safety warning */}
      {nightWarning && (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">⚠ Regreso nocturno</span>
          <p className="mt-0.5 text-xs">
            El evento finaliza después de las 23:00. Evaluar seguridad de la zona
            y medios de transporte disponibles a esa hora.
          </p>
        </div>
      )}

      {/* Action */}
      <button
        onClick={handlePlanTransport}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
      >
        Planificar traslado de todas formas →
      </button>
    </div>
  )
}
