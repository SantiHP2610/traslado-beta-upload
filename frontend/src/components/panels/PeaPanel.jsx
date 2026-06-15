/**
 * PeaPanel.jsx
 * Step 2 content — rendered inside Sidebar below FrescosPanel.
 * No absolute positioning, no Card wrapper.
 *
 * All logic and state dispatches are IDENTICAL to the original.
 * Only the outermost DOM structure changed: position:absolute wrapper and
 * Card wrapper removed.  Sidebar provides the section container.
 */

import { useState }                from 'react'
import { useAppState, ACTIONS }    from '../../state/appState'
import { calculateDriverRoute }    from '../../api/endpoints'

// ── Loading messages keyed on loadingStep ─────────────────────────────────
const LOADING_MESSAGES = {
  meeting_point: 'Calculando punto de encuentro...',
  routes:        'Calculando rutas del chofer...',
  pea:           'Evaluando puntos alternativos...',
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${meters} m`
}

// ── Sub-component: inline spinner ─────────────────────────────────────────

function Spinner({ message }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  )
}

// ── Sub-component: collapsible route summary ──────────────────────────────

function RouteSummary({ driverRoutes }) {
  const [open, setOpen] = useState(false)
  if (!driverRoutes) return null

  const base   = driverRoutes.base_route
  const direct = driverRoutes.direct_route

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Resumen de rutas</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 text-xs pl-3 border-l border-border">
          <div>
            <p className="font-medium" style={{ color: '#B8860B' }}>
              Ruta base (chofer → PE → evento)
            </p>
            <p className="text-muted-foreground">
              {formatDuration(base.duration_seconds)} · {formatDistance(base.distance_meters)}
            </p>
          </div>
          <div>
            <p className="font-medium text-red-500">
              Ruta directa (chofer → evento)
            </p>
            <p className="text-muted-foreground">
              {formatDuration(direct.duration_seconds)} · {formatDistance(direct.distance_meters)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-component: collapsible PE-switch cards ───────────────────────────────
// Shown above the route guidance when allMeetingPoints is loaded and no PE has
// been confirmed yet.  Clicking a card recalculates only the base route (home→PE→
// event); the direct route and PEA candidates are PE-independent and stay as-is.

function AllPeSection({ allMeetingPoints, currentMeetingPoint, onSelect, disabled }) {
  const [open, setOpen] = useState(false)
  if (!allMeetingPoints) return null

  const peList = [allMeetingPoints.recommended, ...(allMeetingPoints.alternatives ?? [])].filter(Boolean)

  function isCurrent(pe) {
    if (!currentMeetingPoint) return false
    return (
      Math.abs(currentMeetingPoint.lat - pe.lat) < 0.0001 &&
      Math.abs(currentMeetingPoint.lng - pe.lng) < 0.0001
    )
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Cambiar punto de encuentro</span>
      </button>
      {open && (
        <div className="space-y-1.5 pl-1">
          {peList.map((pe) => {
            const current = isCurrent(pe)
            return (
              <div
                key={pe.name}
                className={[
                  'rounded border px-2.5 py-2 text-xs transition-all',
                  current
                    ? 'border-yellow-400 bg-yellow-50 cursor-default'
                    : disabled
                      ? 'border-border bg-background cursor-default opacity-60'
                      : 'border-border bg-background hover:bg-muted/30 cursor-pointer',
                ].join(' ')}
                onClick={() => !current && !disabled && onSelect(pe)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">{pe.name}</p>
                    <p className="text-muted-foreground mt-0.5 leading-snug truncate">{pe.address}</p>
                    {pe.duration_seconds != null && (
                      <p className="text-muted-foreground mt-0.5">
                        {Math.ceil(pe.duration_seconds / 60)} min al evento
                      </p>
                    )}
                  </div>
                  {current ? (
                    <span className="shrink-0 text-yellow-600 font-semibold">✓</span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (!disabled) onSelect(pe) }}
                      disabled={disabled}
                      className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                    >
                      Elegir
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PeaPanel() {
  const { state, dispatch } = useAppState()
  const [selectingPe, setSelectingPe] = useState(false)

  const { loadingStep, driverRoutes, peaEvaluation, chosenMeetingPoint,
          personalVehicle, manualPeaMode, allMeetingPoints, meetingPoint,
          coordinateOverrides, staffWithCoords } = state

  const isLoading      = loadingStep !== null
  const driver         = personalVehicle?.driver
  const vehicleDesc    = personalVehicle?.vehicle_description ?? ''
  const driverName     = driver ? `${driver.Nombre} ${driver.Apellido}` : ''
  const hasCandidates  = peaEvaluation?.has_candidates ?? false
  const candidateCount = peaEvaluation?.candidates?.length ?? 0

  const driverOverride       = driverName ? coordinateOverrides?.[driverName] : null
  const driverOriginalCoords = driverName
    ? staffWithCoords?.find((e) => `${e.Nombre} ${e.Apellido}` === driverName)?.coordinates
    : null

  async function handleSelectPe(pe) {
    if (selectingPe) return
    setSelectingPe(true)
    dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: pe })
    dispatch({ type: ACTIONS.SET_MEETING_POINT,  payload: pe })
    try {
      // Recalculate only the base route (home→PE→event); direct route and PEA
      // depend on home→event only, so they stay exactly as computed by useStepTwo.
      const drLat  = driverOverride?.lat ?? driverOriginalCoords?.lat ?? null
      const drLng  = driverOverride?.lng ?? driverOriginalCoords?.lng ?? null
      const routes = await calculateDriverRoute(drLat, drLng, pe.lat, pe.lng)
      dispatch({ type: ACTIONS.SET_DRIVER_ROUTES,  payload: routes })
      dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: null })
    } catch { /* route failure is non-fatal — the existing route remains */ }
    setSelectingPe(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-gray-900">
        Punto de encuentro
      </p>

      {/* ── PE switch cards — shown before a choice is confirmed ─────── */}
      {/* Hidden once chosenMeetingPoint is set or while loading.        */}
      {!isLoading && !chosenMeetingPoint && allMeetingPoints && (
        <AllPeSection
          allMeetingPoints={allMeetingPoints}
          currentMeetingPoint={meetingPoint}
          onSelect={handleSelectPe}
          disabled={selectingPe}
        />
      )}

      {/* ── Loading state ───────────────────────────────────────────── */}
      {isLoading && (
        <Spinner message={LOADING_MESSAGES[loadingStep] ?? 'Calculando...'} />
      )}

      {/* ── Loaded, no choice yet ───────────────────────────────────── */}
      {!isLoading && !chosenMeetingPoint && (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Seleccioná el punto de encuentro para{' '}
              {vehicleDesc && driverName
                ? `${vehicleDesc} de ${driverName}`
                : driverName
                  ? `el vehículo de ${driverName}`
                  : 'el vehículo'}
            </p>
            <p className="text-xs text-muted-foreground">
              Hacé click sobre un marcador{' '}
              <span className="font-medium text-yellow-500">amarillo (PE)</span>
              {hasCandidates && (
                <>
                  {' '}o{' '}
                  <span className="font-medium text-orange-500">naranja (PEA)</span>
                </>
              )}{' '}
              en el mapa para ver las opciones.
            </p>
          </div>

          <RouteSummary driverRoutes={driverRoutes} />

          <div className="text-xs">
            {peaEvaluation && !hasCandidates && (
              <p className="text-muted-foreground">
                No se encontraron puntos alternativos. Solo está disponible el PE original.
              </p>
            )}
            {peaEvaluation && hasCandidates && (
              <p>
                Hay{' '}
                <span className="font-medium text-orange-500">
                  {candidateCount} punto{candidateCount !== 1 ? 's' : ''} alternativo{candidateCount !== 1 ? 's' : ''}
                </span>
                {' '}disponible{candidateCount !== 1 ? 's' : ''} (marcadores naranjas).
              </p>
            )}
          </div>

          {/* ── Manual PEA selection ───────────────────────────────── */}
          {driverRoutes && !manualPeaMode && (
            <button
              onClick={() => dispatch({ type: 'SET_MANUAL_PEA_MODE', payload: true })}
              className="w-full text-left text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors"
            >
              Elegir PEA en mapa manualmente
            </button>
          )}
          {manualPeaMode && (
            <div
              style={{
                background:   '#eff6ff',
                border:       '1px solid #bfdbfe',
                borderRadius: 6,
                padding:      '8px 10px',
                fontSize:     12,
                color:        '#1e40af',
              }}
            >
              <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
                Modo selección manual
              </p>
              <p style={{ margin: '0 0 6px', lineHeight: 1.4 }}>
                Hacé click sobre la ruta alternativa (roja) en el mapa para elegir un PEA.
              </p>
              <button
                onClick={() => dispatch({ type: 'SET_MANUAL_PEA_MODE', payload: false })}
                style={{
                  background:   'none',
                  border:       'none',
                  padding:      0,
                  fontSize:     11,
                  color:        '#2563eb',
                  cursor:       'pointer',
                  textDecoration: 'underline',
                }}
              >
                Cancelar
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Point chosen — confirmed; UberRoutesSection below handles advance ── */}
      {!isLoading && chosenMeetingPoint && (
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Punto elegido
          </p>
          <p className="text-sm font-medium text-foreground">
            ✓ {chosenMeetingPoint.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {chosenMeetingPoint.address}
          </p>
        </div>
      )}

      {/* Inline error */}
      {state.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </div>
  )
}
