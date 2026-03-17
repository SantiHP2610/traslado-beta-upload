/**
 * FinalOutputBlocks.jsx
 * Full-screen summary panel shown after the user confirms all assignments.
 * Replaces the former two draggable blocks with a single centered panel
 * covering 85% of the viewport.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 * A semi-transparent backdrop (pointer-events:none) keeps the map visible and
 * interactive behind the panel.  The panel itself sits at z-50 and is centered
 * via transform: translate(-50%, -50%).
 *
 * Content is split into two scrollable columns side by side:
 *   Left:  "Salida desde CP"  — frescos vehicle, crew, departure time + breakdown.
 *   Right: "Salida desde PE"  — meeting point, departure time + breakdown,
 *                                personal vehicle, pickup, Uber groups.
 * Each column has its own clipboard copy button.
 *
 * ── "Volver a editar" ────────────────────────────────────────────────────────
 * Dispatches SET_SHOW_OUTPUT false + SET_SHOW_MODAL false + SET_CURRENT_STEP 3.
 * All accumulated state (assignments, meeting point, routes, PEA evaluation)
 * is preserved exactly — no API calls are repeated.
 *
 * ── Departure breakdowns ─────────────────────────────────────────────────────
 * CP:  cp_departure returns { departure_time, extra_prep_applied,
 *      extra_prep_reason, total_minutes_before_event }.  Individual components
 *      are not included, so travel_minutes is derived by subtracting the known
 *      config constants (mirrored as module-level constants below).
 * PE:  pe_departure returns { departure_time, breakdown: { event_time,
 *      prep_hours, travel_minutes, buffer_minutes, extra_prep_hours,
 *      extra_prep_reason, total_minutes_before_event } }.  Used directly.
 *
 * ── Pickup departure time ────────────────────────────────────────────────────
 * pickup_time = departure_from_pe − transit_time_to_pickup_minutes.
 * The backend does not compute this; transit_time_to_pickup_minutes was stored
 * in state.assignments.pickup_transit_minutes when the user confirmed the pickup
 * in PickupResultPanel.
 */

import { useState }                         from 'react'
import { useAppState, ACTIONS }             from '../../state/appState'
import { Card, CardContent, CardHeader,
         CardTitle }                        from '@/components/ui/card'
import { Button }                           from '@/components/ui/button'

// ── Config constants mirrored from config.py ──────────────────────────────────
// Kept here to derive the CP travel-time component without an extra API call.
const DEPARTURE_PREP_HOURS     = 4
const DEPARTURE_BUFFER_MINUTES = 10
const LOADING_TIME_MINUTES     = 50
const LONG_EVENT_EXTRA_HOURS   = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cpTravelMinutes(totalMinutes, extraPrepApplied) {
  return totalMinutes
    - DEPARTURE_PREP_HOURS * 60
    - DEPARTURE_BUFFER_MINUTES
    - LOADING_TIME_MINUTES
    - (extraPrepApplied ? LONG_EVENT_EXTRA_HOURS * 60 : 0)
}

function computePickupTime(departureFromPe, transitMinutes) {
  if (!departureFromPe || transitMinutes == null) return null
  const [h, m]  = departureFromPe.split(':').map(Number)
  const total   = h * 60 + m - transitMinutes
  const wrapped = ((total % 1440) + 1440) % 1440
  const hOut    = Math.floor(wrapped / 60)
  const mOut    = wrapped % 60
  return `${String(hOut).padStart(2, '0')}:${String(mOut).padStart(2, '0')}`
}

function getProfesion(nameStr, staff) {
  return staff.find((e) => `${e.Nombre} ${e.Apellido}` === nameStr)?.Profesion ?? null
}

function frescosText(fb, event) {
  const lines = [
    `FRESCOS — ${fb.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete contratado'}`,
    `Equipo: ${(fb.assigned_names ?? []).join(', ')}`,
    `Salida CP: ${fb.departure_from_cp}`,
  ]
  if (fb.second_miniflete?.needs_second_miniflete) {
    lines.push(`Segundo miniflete: Sí (${fb.second_miniflete.reason})`)
    lines.push('Sale junto con el vehículo principal')
  }
  if (event?.hora_inicio) lines.push(`Hora evento: ${event.hora_inicio}`)
  return lines.join('\n')
}

function transportText(tb, assignments) {
  const lines = [
    `TRASLADO — PE: ${tb.meeting_point?.name ?? ''}`,
    `Salida PE: ${tb.departure_from_pe}`,
  ]
  const pv = tb.personal_vehicle
  if (pv?.driver) {
    lines.push(`Chofer: ${pv.driver}`)
    if ((pv.passengers ?? []).length) {
      lines.push(`Pasajeros: ${pv.passengers.join(', ')}`)
    }
  }
  if (assignments?.pickup_employee) {
    const peName = `${assignments.pickup_employee.Nombre} ${assignments.pickup_employee.Apellido}`
    lines.push(`Pickup: ${peName} en ${assignments.pickup_place?.place_name ?? ''}`)
  }
  ;(tb.uber_groups ?? []).forEach((g) => {
    lines.push(`Uber ${g.group_number}: ${(g.passengers ?? []).join(', ')}`)
  })
  if (assignments?.pending_employee) {
    const pendName = `${assignments.pending_employee.Nombre} ${assignments.pending_employee.Apellido}`
    lines.push(`Pendiente (transporte alternativo): ${pendName}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

function BreakdownRow({ label, value, note, amber }) {
  return (
    <div className={`flex justify-between gap-2 text-xs ${amber ? 'text-amber-600' : 'text-muted-foreground'}`}>
      <span>{label}</span>
      <span className="text-right">
        {value}
        {note && <span className="block text-[10px] leading-tight">{note}</span>}
      </span>
    </div>
  )
}

function DepartureSection({ departureTime, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Salida: {departureTime}</p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label={open ? 'Ocultar desglose' : 'Ver desglose'}
        >
          {open ? '▲ Ocultar' : '▼ Desglose'}
        </button>
      </div>
      {open && (
        <div className="rounded-md bg-muted/50 p-2 space-y-1">
          {children}
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API requires HTTPS or localhost — always true here.
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full text-xs"
      onClick={handleCopy}
    >
      {copied ? 'Copiado ✓' : 'Copiar'}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FinalOutputBlocks() {
  const { state, dispatch } = useAppState()

  const finalOut = state.finalOutput
  if (!finalOut?.frescos_block || !finalOut?.transport_block) return null

  const fb          = finalOut.frescos_block
  const tb          = finalOut.transport_block
  const staff       = state.excelData?.staff ?? []
  const event       = state.excelData?.event ?? {}
  const assignments = state.assignments

  // ── Frescos breakdown ────────────────────────────────────────────────────
  const cpBd     = fb.departure_breakdown
  const cpTravel = cpBd
    ? cpTravelMinutes(cpBd.total_minutes_before_event, cpBd.extra_prep_applied)
    : null

  // ── Transport breakdown ──────────────────────────────────────────────────
  const peBd       = tb.departure_breakdown
  const peBdDetail = peBd?.breakdown

  // ── Pickup departure time ────────────────────────────────────────────────
  const pickupTime = computePickupTime(
    tb.departure_from_pe,
    assignments?.pickup_transit_minutes,
  )

  // ── "Volver a editar": close panel, clear modal, return to step 3 ────────
  // All state (assignments, meeting point, routes) is preserved — no API calls.
  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_OUTPUT,  payload: false })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  return (
    <>
      {/*
        Backdrop — dims the map to signal the panel is active, but
        pointer-events:none keeps the map fully interactive underneath.
      */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.30)',
          zIndex: 40,
          pointerEvents: 'none',
        }}
      />

      {/* Panel — centered, 85vw × 85vh, non-draggable */}
      <div
        style={{
          position:  'fixed',
          left:      '50%',
          top:       '50%',
          transform: 'translate(-50%, -50%)',
          width:     '85vw',
          height:    '85vh',
          zIndex:    50,
          pointerEvents: 'auto',
        }}
      >
        <Card className="h-full flex flex-col shadow-2xl">

          {/* Header */}
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-base">Plan de traslado confirmado</CardTitle>
            {(event.fecha || event.hora_inicio || event.tipo) && (
              <p className="text-xs text-muted-foreground">
                {[event.fecha, event.hora_inicio, event.tipo].filter(Boolean).join(' — ')}
              </p>
            )}
          </CardHeader>

          <CardContent className="flex-1 overflow-hidden flex flex-col gap-4 pt-0">

            {/* Two-column content area */}
            <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6">

              {/* ── Left: Salida desde CP ────────────────────────────────── */}
              <div className="overflow-y-auto space-y-4 pr-4 border-r border-border">

                <p className="text-sm font-semibold">Salida desde CP</p>

                {/* Vehicle + crew */}
                <div className="space-y-1">
                  <SectionTitle>Vehículo</SectionTitle>
                  <p className="text-xs font-medium">
                    {fb.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete contratado'}
                  </p>
                  {(fb.assigned_names ?? []).map((name) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" />
                      <span className="text-xs">
                        {name}
                        {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>

                {/* CP departure + breakdown */}
                <div className="space-y-1">
                  <SectionTitle>Salida del CP</SectionTitle>
                  <DepartureSection departureTime={fb.departure_from_cp}>
                    {cpBd && (
                      <>
                        <BreakdownRow label="Hora evento"    value={event.hora_inicio ?? '—'} />
                        <BreakdownRow label="Prep en venue"  value={`${DEPARTURE_PREP_HOURS}h`} />
                        <BreakdownRow
                          label="Tiempo de viaje"
                          value={`${cpTravel} min`}
                          note="calculado con tráfico real al arribo"
                        />
                        <BreakdownRow label="Buffer"         value={`${DEPARTURE_BUFFER_MINUTES} min`} />
                        <BreakdownRow label="Carga en CP"    value={`${LOADING_TIME_MINUTES} min`} />
                        {cpBd.extra_prep_applied && (
                          <BreakdownRow
                            label={`Extra prep (${(cpBd.extra_prep_reason ?? []).join(', ')})`}
                            value={`${LONG_EVENT_EXTRA_HOURS}h`}
                            amber
                          />
                        )}
                        <div className="border-t border-border pt-1">
                          <BreakdownRow
                            label="Total antes del evento"
                            value={`${cpBd.total_minutes_before_event} min`}
                          />
                        </div>
                      </>
                    )}
                  </DepartureSection>
                </div>

                {/* Second miniflete */}
                {fb.second_miniflete?.needs_second_miniflete && (
                  <div className="space-y-0.5">
                    <SectionTitle>Segundo miniflete</SectionTitle>
                    <p className="text-xs text-muted-foreground">{fb.second_miniflete.reason}</p>
                    <p className="text-xs text-muted-foreground">Sale junto con el vehículo principal</p>
                  </div>
                )}

                <CopyButton text={frescosText(fb, event)} />
              </div>

              {/* ── Right: Salida desde PE ───────────────────────────────── */}
              <div className="overflow-y-auto space-y-4 pl-2">

                <p className="text-sm font-semibold">Salida desde Punto de Encuentro</p>

                {/* Meeting point */}
                <div className="space-y-0.5">
                  <SectionTitle>Punto de encuentro</SectionTitle>
                  <p className="text-xs font-medium">{tb.meeting_point?.name}</p>
                  {tb.meeting_point?.address && (
                    <p className="text-xs text-muted-foreground">{tb.meeting_point.address}</p>
                  )}
                </div>

                {/* PE departure + breakdown */}
                <div className="space-y-1">
                  <SectionTitle>Salida del PE</SectionTitle>
                  <DepartureSection departureTime={tb.departure_from_pe}>
                    {peBdDetail && (
                      <>
                        <BreakdownRow label="Hora evento"    value={peBdDetail.event_time ?? '—'} />
                        <BreakdownRow label="Prep en venue"  value={`${peBdDetail.prep_hours}h`} />
                        <BreakdownRow
                          label="Tiempo de viaje"
                          value={`${peBdDetail.travel_minutes} min`}
                          note="calculado con tráfico real al arribo"
                        />
                        <BreakdownRow label="Buffer"         value={`${peBdDetail.buffer_minutes} min`} />
                        {peBdDetail.extra_prep_hours > 0 && (
                          <BreakdownRow
                            label={`Extra prep (${(peBdDetail.extra_prep_reason ?? []).join(', ')})`}
                            value={`${peBdDetail.extra_prep_hours}h`}
                            amber
                          />
                        )}
                        <div className="border-t border-border pt-1">
                          <BreakdownRow
                            label="Total antes del evento"
                            value={`${peBdDetail.total_minutes_before_event} min`}
                          />
                        </div>
                      </>
                    )}
                  </DepartureSection>
                </div>

                {/* Personal vehicle */}
                {tb.personal_vehicle?.driver && (
                  <div className="space-y-1">
                    <SectionTitle>Vehículo personal</SectionTitle>
                    {assignments?.pickup_employee && (
                      <p className="text-xs text-muted-foreground">Se dirigen al Punto de Encuentro:</p>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                      <span className="text-xs">
                        {tb.personal_vehicle.driver}
                        {getProfesion(tb.personal_vehicle.driver, staff)
                          ? ` — ${getProfesion(tb.personal_vehicle.driver, staff)}`
                          : ''}
                        <span className="text-muted-foreground"> (chofer)</span>
                      </span>
                    </div>
                    {(tb.personal_vehicle.passengers ?? []).map((name) => (
                      <div key={name} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                        <span className="text-xs">
                          {name}
                          {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                        </span>
                      </div>
                    ))}

                    {/* Pickup */}
                    {assignments?.pickup_employee && (
                      <div className="pt-0.5 space-y-0.5">
                        <p className="text-xs text-muted-foreground">Se encuentra en el punto de pickup:</p>
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-yellow-400 shrink-0" />
                          <span className="text-xs">
                            {`${assignments.pickup_employee.Nombre} ${assignments.pickup_employee.Apellido}`}
                            {assignments.pickup_employee.Profesion
                              ? ` — ${assignments.pickup_employee.Profesion}`
                              : ''}
                            <span className="text-muted-foreground"> (pickup)</span>
                          </span>
                        </div>
                        {assignments.pickup_place && (
                          <p className="text-xs text-muted-foreground pl-3.5">
                            {assignments.pickup_place.place_name}
                            {assignments.pickup_place.place_address
                              ? ` — ${assignments.pickup_place.place_address}`
                              : ''}
                          </p>
                        )}
                        {pickupTime && (
                          <p className="text-xs text-muted-foreground pl-3.5">
                            Horario pickup estimado: {pickupTime}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Uber groups */}
                {(tb.uber_groups ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    <SectionTitle>Uber</SectionTitle>
                    {tb.uber_groups.map((group) => (
                      <div key={group.group_number} className="space-y-0.5">
                        {tb.uber_groups.length > 1 ? (
                          <p className="text-xs text-muted-foreground">
                            Uber {group.group_number} ({group.passengers?.length}{' '}
                            {group.passengers?.length === 1 ? 'pasajero' : 'pasajeros'})
                            {' '}→ {tb.meeting_point?.name}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {group.passengers?.length}{' '}
                            {group.passengers?.length === 1 ? 'pasajero' : 'pasajeros'}
                            {' '}→ {tb.meeting_point?.name}
                          </p>
                        )}
                        {(group.passengers ?? []).map((name) => (
                          <div key={name} className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                            <span className="text-xs">
                              {name}
                              {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Pending employee */}
                {assignments?.pending_employee && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-2 space-y-1">
                    <SectionTitle>Pendiente</SectionTitle>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-xs">
                        {`${assignments.pending_employee.Nombre} ${assignments.pending_employee.Apellido}`}
                        {assignments.pending_employee.Profesion
                          ? ` — ${assignments.pending_employee.Profesion}`
                          : ''}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700">Transporte alternativo a coordinar</p>
                  </div>
                )}

                <CopyButton text={transportText(tb, assignments)} />
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-border pt-3 flex justify-end">
              <Button variant="outline" onClick={handleEdit}>
                Volver a editar
              </Button>
            </div>

          </CardContent>
        </Card>
      </div>
    </>
  )
}
