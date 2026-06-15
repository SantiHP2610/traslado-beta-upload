/**
 * MeetingPointMarkers.jsx
 * Renders clickable markers for the original PE (green) and up to 3 PEA
 * candidates (orange), each with a detailed InfoWindow.
 *
 * ── Why selection lives on map markers, not in the panel ─────────────────────
 * The whole reason step 2 exists is spatial: the user needs to see the routes,
 * the staff home locations, and the candidate meeting points on the same map
 * before deciding.  Putting selection buttons in the panel would force the user
 * to read data in a table and make an abstract choice, losing the spatial
 * context that makes the decision meaningful.
 *
 * Placing the "Elegir" button inside the InfoWindow anchors the action to the
 * exact location being considered — the user clicks a marker on the map, reads
 * the data in context, and confirms their choice in the same place.
 *
 * ── Why the PE marker is always shown (not only if PEA exists) ───────────────
 * The user may expect that the default PE is always available.  Hiding it when
 * PEA candidates exist would make the PE choice invisible, potentially leading
 * the user to assume PEA is the only option.  Both options are always rendered
 * side by side so the comparison is explicit.
 *
 * ── Chosen marker visual feedback and persistence ────────────────────────────
 * When the user clicks "Elegir" on any marker, SET_CHOSEN_MEETING_POINT is
 * dispatched.  This component reads chosenMeetingPoint and:
 *   1. Hides all unchosen markers immediately (unchosen PE if PEA chosen, or
 *      all PEA candidates if PE chosen) — reduces visual noise and signals
 *      the decision is final.
 *   2. Shows the chosen marker at 1.4× scale with a white ring border and a
 *      checkmark glyph — larger and visually distinct so it remains legible
 *      even when surrounded by staff markers in steps 3 and 4.
 *   3. Remains rendered in steps 3 and 4 (AppMap renders this component for
 *      currentStep >= 2, not just step 2).  The chosen meeting point is the
 *      most operationally critical location on the map — every transport
 *      vehicle converges on it and it must always be visible.
 *
 * ── Per-employee table in PEA InfoWindow ─────────────────────────────────────
 * staff_metrics returned by the backend gives each employee's transit times to
 * the candidate and to the original PE, plus the time saved and a flag for
 * whether transit exceeds the soft maximum.  Showing this table lets the manager
 * see at a glance which employees benefit most (or are penalised) by the PEA.
 */

import { useState }                            from 'react'
import { AdvancedMarker, InfoWindow, Pin }      from '@vis.gl/react-google-maps'
import { useAppState, ACTIONS }                from '../../state/appState'
import { Card, CardContent }                   from '@/components/ui/card'
import { Button }                              from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Pin color palette
// ---------------------------------------------------------------------------
// Yellow (#FBBC04) for both unselected and selected PE states — the marker
// colour matches the route colour before and after the user commits to this PE.
// The selected state is distinguished by 1.4× scale, white ring border, and
// a ✓ glyph; the yellow background stays consistent so the marker is
// immediately recognisable as "the meeting point" throughout steps 3 and 4.
const PE_COLORS = {
  default:  { background: '#FBBC04', border: '#d6a000', glyph: '#1a1a1a' },
  selected: { background: '#FBBC04', border: '#d6a000', glyph: '#1a1a1a' },
}
const PEA_COLORS = {
  default:  { background: '#FF6D00', border: '#e65100', glyph: '#ffffff' },
  selected: { background: '#b34600', border: '#7a2f00', glyph: '#ffffff' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${meters} m`
}

// ---------------------------------------------------------------------------
// Sub-component: PE InfoWindow content
// ---------------------------------------------------------------------------

function PeInfoContent({ meetingPoint, onChoose }) {
  return (
    <Card className="min-w-[220px] shadow-none border-0">
      <CardContent className="p-3 space-y-2">
        <p className="font-semibold text-sm leading-tight">
          Punto de encuentro
        </p>
        <p className="text-sm font-medium">{meetingPoint.name}</p>
        <p className="text-xs text-muted-foreground">{meetingPoint.address}</p>

        {/* Distance/duration from CP to event via this PE */}
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>{formatDuration(meetingPoint.duration_seconds)} desde CP</span>
          <span>{formatDistance(meetingPoint.distance_meters)}</span>
        </div>

        <Button
          className="w-full mt-1"
          size="sm"
          onClick={onChoose}
        >
          Elegir como punto de encuentro
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: PEA InfoWindow content
// ---------------------------------------------------------------------------

function PeaInfoContent({ candidate, onChoose }) {
  return (
    <Card className="min-w-[260px] shadow-none border-0">
      <CardContent className="p-3 space-y-2">
        <p className="font-semibold text-sm leading-tight">
          Punto de encuentro alternativo
        </p>
        <p className="text-sm font-medium">{candidate.name}</p>
        <p className="text-xs text-muted-foreground">{candidate.address}</p>

        {/* Key metrics */}
        <div className="space-y-0.5 text-xs">
          <p>
            <span className="font-medium text-green-600">
              {Math.round(candidate.top4_savings_minutes)} min ahorrados
            </span>
            {' '}(top 4 más cercanos)
          </p>
          <p>
            <span className="font-medium">
              {candidate.exclusively_prefer_count}
            </span>
            {' '}empleado{candidate.exclusively_prefer_count !== 1 ? 's' : ''} lo prefiere{candidate.exclusively_prefer_count !== 1 ? 'n' : ''}
          </p>
        </div>

        {/* Top-4 employees driving the score */}
        {candidate.top4_employees && candidate.top4_employees.length > 0 && (
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold uppercase tracking-wide text-muted-foreground">
              Top {candidate.top4_employees.length} empleados
            </p>
            {candidate.top4_employees.map((e) => (
              <div key={e.employee_name} className="flex justify-between gap-2">
                <span className="truncate max-w-[120px]">{e.employee_name}</span>
                <span className={e.time_saved_min >= 0 ? 'text-green-600' : 'text-red-500'}>
                  {e.time_saved_min >= 0 ? '+' : ''}{Math.round(e.time_saved_min)} min
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Remuneration warning */}
        {candidate.remuneration_note && (
          <p className="text-xs text-amber-600 font-medium">
            ⚠ {candidate.remuneration_note}
          </p>
        )}

        {/* Per-employee transit table */}
        {candidate.staff_metrics && candidate.staff_metrics.length > 0 && (
          <div className="mt-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Tránsito por empleado
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-normal pb-0.5">Empleado</th>
                  <th className="text-right font-normal pb-0.5">Al PEA</th>
                  <th className="text-right font-normal pb-0.5">Al PE</th>
                  <th className="text-right font-normal pb-0.5">Ahorro</th>
                  <th className="text-right font-normal pb-0.5">⚠</th>
                </tr>
              </thead>
              <tbody>
                {candidate.staff_metrics.map((m) => (
                  <tr key={m.employee_name}>
                    <td className="pr-2 py-0.5 max-w-[100px] truncate">
                      {m.employee_name}
                    </td>
                    <td className="text-right py-0.5">
                      {Math.round(m.transit_to_candidate_min)}m
                    </td>
                    <td className="text-right py-0.5">
                      {Math.round(m.transit_to_pe_min)}m
                    </td>
                    <td className="text-right py-0.5">
                      {Math.round(m.time_saved_min)}m
                    </td>
                    <td className="text-right py-0.5">
                      {m.exceeds_max_transit && (
                        <span className="text-amber-500">⚠</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Button
          className="w-full mt-1"
          size="sm"
          onClick={onChoose}
        >
          Elegir como punto de encuentro
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MeetingPointMarkers() {
  const { state, dispatch } = useAppState()

  // Local state: which marker's InfoWindow is currently open.
  // "pe" | "pea-0" | "pea-1" | "pea-2" | null
  // This is purely display state — no other part of the app needs it.
  const [openKey, setOpenKey] = useState(null)

  const meetingPoint = state.meetingPoint
  const pea          = state.peaEvaluation
  const chosen       = state.chosenMeetingPoint

  // Temporary highlighted PE — shown while the manager browses PE cards in
  // the charter PE selection sidebar.  Different React key from real PE markers
  // so it appears/disappears instantly (no cross-point animation).
  const highlightedPE = state.highlightedPE


  // Allow rendering even when meetingPoint is not yet set (charter step 2:
  // the user is browsing PE cards and we only have a highlighted preview).
  if (!meetingPoint && !highlightedPE) return null

  // True when this specific point is the currently chosen meeting point.
  // Matched by lat+lng because the data shape varies between PE and PEA objects.
  
  function isChosen(point) {
    if (!chosen || !point) return false
    return (
      Math.abs(chosen.lat - point.lat) < 0.0001 &&
      Math.abs(chosen.lng - point.lng) < 0.0001
    )
  }

  function handleChoose(point) {
    dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT, payload: point })
    setOpenKey(null)   // close the InfoWindow after choosing
  }

  const peChosen   = isChosen(meetingPoint)   // false when meetingPoint is null
  const peColors   = peChosen ? PE_COLORS.selected  : PE_COLORS.default
  const candidates = pea?.has_candidates ? (pea.candidates ?? []) : []

  // isPostChoice: the user has selected a meeting point (PE or PEA).
  // Once a choice is made:
  //   - Only the chosen marker is rendered (unchosen markers are removed).
  //   - The chosen marker shows at 1.4× scale with a white ring border so it
  //     remains clearly visible among staff markers in steps 3 and 4.
  // Before a choice: all markers are rendered at 1.0× (existing behaviour).
  const isPostChoice = chosen !== null

  // isManualPea: the confirmed meeting point was set via manual map click and
  // does not appear in either the original PE or the auto-generated candidates.
  // In this case the candidates loop and PE block render nothing, so we need a
  // dedicated marker block below.
  const isManualPea =
    meetingPoint !== null &&
    chosen !== null &&
    !isChosen(meetingPoint) &&
    !candidates.some((c) => isChosen(c))

  return (
    <>
      {highlightedPE && (
        <AdvancedMarker
          key={`highlight-${highlightedPE.lat}-${highlightedPE.lng}`}
          position={{ lat: highlightedPE.lat, lng: highlightedPE.lng }}
          title={highlightedPE.name}
        >
          <Pin
            background="#FBBC04"
            borderColor="#ffffff"
            glyphColor="#1a1a1a"
            glyph="PE"
            scale={1.3}
          />
        </AdvancedMarker>
      )}

      {/* ── Original PE marker — only rendered once meetingPoint is available */}
      {/* Hidden once a choice is made and PE was NOT the chosen point.        */}
      {meetingPoint && (!isPostChoice || peChosen) && (
        <>
          <AdvancedMarker
            position={{ lat: meetingPoint.lat, lng: meetingPoint.lng }}
            title={meetingPoint.name}
            onClick={() => setOpenKey(openKey === 'pe' ? null : 'pe')}
          >
            <Pin
              background={peColors.background}
              // White ring on the chosen marker makes it unambiguous even when
              // surrounded by staff markers — the most important location on the
              // map must always be findable at a glance.
              borderColor={peChosen ? '#ffffff' : peColors.border}
              glyphColor={peColors.glyph}
              glyph={peChosen ? '✓' : 'PE'}
              scale={peChosen ? 1.4 : 1.0}
            />
          </AdvancedMarker>

          {openKey === 'pe' && (
            <InfoWindow
              position={{ lat: meetingPoint.lat, lng: meetingPoint.lng }}
              pixelOffset={[0, -40]}
              onCloseClick={() => setOpenKey(null)}
              shouldFocus={false}
            >
              <PeInfoContent
                meetingPoint={meetingPoint}
                onChoose={() => handleChoose(meetingPoint)}
              />
            </InfoWindow>
          )}
        </>
      )}

      {/* ── PEA candidate markers ────────────────────────────────────────── */}
      {/* Each candidate is hidden once a choice is made and it was not       */}
      {/* the chosen one (including the original PE marker when PEA chosen).  */}
      {meetingPoint && candidates.map((candidate, i) => {
        const markerKey = `pea-${i}`
        const peaChosen = isChosen(candidate)
        const peaColors = peaChosen ? PEA_COLORS.selected : PEA_COLORS.default

        // Skip unchosen candidates once a selection has been made.
        if (isPostChoice && !peaChosen) return null

        return (
          <span key={candidate.address}>
            <AdvancedMarker
              position={{ lat: candidate.lat, lng: candidate.lng }}
              title={`PEA ${i + 1}: ${candidate.name}`}
              onClick={() => setOpenKey(openKey === markerKey ? null : markerKey)}
            >
              <Pin
                background={peaColors.background}
                borderColor={peaChosen ? '#ffffff' : peaColors.border}
                glyphColor={peaColors.glyph}
                glyph={peaChosen ? '✓' : String(i + 1)}
                scale={peaChosen ? 1.4 : 1.0}
              />
            </AdvancedMarker>

            {openKey === markerKey && (
              <InfoWindow
                position={{ lat: candidate.lat, lng: candidate.lng }}
                pixelOffset={[0, -40]}
                onCloseClick={() => setOpenKey(null)}
                shouldFocus={false}
              >
                <PeaInfoContent
                  candidate={candidate}
                  onChoose={() => handleChoose(candidate)}
                />
              </InfoWindow>
            )}
          </span>
        )
      })}

      {/* ── Manually selected PEA marker ─────────────────────────────────── */}
      {/* Rendered when the confirmed meeting point came from a manual map    */}
      {/* click and does not appear in the automatic candidate list.          */}
      {isManualPea && (
        <>
          <AdvancedMarker
            position={{ lat: chosen.lat, lng: chosen.lng }}
            title={chosen.name ?? 'PEA Manual'}
            onClick={() => setOpenKey(openKey === 'manual-pea' ? null : 'manual-pea')}
          >
            <Pin
              background={PEA_COLORS.selected.background}
              borderColor="#ffffff"
              glyphColor={PEA_COLORS.selected.glyph}
              glyph="✓"
              scale={1.4}
            />
          </AdvancedMarker>

          {openKey === 'manual-pea' && (
            <InfoWindow
              position={{ lat: chosen.lat, lng: chosen.lng }}
              pixelOffset={[0, -40]}
              onCloseClick={() => setOpenKey(null)}
              shouldFocus={false}
            >
              <Card className="min-w-[220px] shadow-none border-0">
                <CardContent className="p-3 space-y-1">
                  <p className="font-semibold text-sm leading-tight">
                    Punto de encuentro alternativo
                  </p>
                  <p className="text-xs text-orange-600 font-medium">
                    Seleccionado manualmente
                  </p>
                  {chosen.name && (
                    <p className="text-sm font-medium">{chosen.name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{chosen.address}</p>
                </CardContent>
              </Card>
            </InfoWindow>
          )}
        </>
      )}
    </>
  )
}
