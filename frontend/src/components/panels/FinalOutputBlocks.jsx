/**
 * FinalOutputBlocks.jsx
 * Full-screen summary panel shown after the user confirms all assignments.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 * A semi-transparent backdrop keeps the map visible behind the panel.
 * Content is split into two scrollable columns:
 *   Left:  "Salida desde CP"  — frescos vehicle, crew, departure time + breakdown.
 *   Right: "Salida desde PE"  — meeting point, departure time, vehicles (personal
 *          + Uber), pending employee.
 *
 * ── Data sources ─────────────────────────────────────────────────────────────
 * tb.vehicles (from /final-output) carries the vehicle array.
 * Pickup timing (leg_seconds, pickup_before_pe) is read from
 * state.vehicles[personal].route — the backend does not carry route data.
 */

import { useState }                         from 'react'
import { useAppState, ACTIONS, VEHICLE_COLORS } from '../../state/appState'
import { Card, CardContent, CardHeader,
         CardTitle }                        from '@/components/ui/card'
import { Button }                           from '@/components/ui/button'

// ── Config constants mirrored from config.py ──────────────────────────────────
const DEPARTURE_PREP_HOURS     = 4
const DEPARTURE_BUFFER_MINUTES = 10
const LOADING_TIME_MINUTES     = 50
const LONG_EVENT_EXTRA_HOURS   = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cpTravelMinutes(totalMinutes, extraPrepApplied, loadingTimeMinutes) {
  return totalMinutes
    - DEPARTURE_PREP_HOURS * 60
    - DEPARTURE_BUFFER_MINUTES
    - loadingTimeMinutes
    - (extraPrepApplied ? LONG_EVENT_EXTRA_HOURS * 60 : 0)
}

function computePickupInfo(departureFromPe, legSeconds, pickupBeforePe) {
  if (legSeconds == null) return { time: null, label: 'Horario a confirmar' }

  const legMinutes = Math.ceil(legSeconds / 60)
  const label = pickupBeforePe
    ? `${legMinutes} min antes del PE`
    : `${legMinutes} min después del PE`

  if (!departureFromPe) return { time: null, label }

  const [h, m] = departureFromPe.split(':').map(Number)
  const total  = h * 60 + m + (pickupBeforePe ? -legMinutes : +legMinutes)
  const wrapped = ((total % 1440) + 1440) % 1440
  const time = `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
  return { time, label }
}

function getProfesion(nameStr, staff) {
  return staff.find((e) => `${e.Nombre} ${e.Apellido}` === nameStr)?.Profesion ?? null
}

function vehicleDisplayName(v) {
  if (v.type === 'personal') {
    return v.vehicle_description && v.driver
      ? `${v.vehicle_description} de ${v.driver}`
      : v.driver ? `Vehículo de ${v.driver}` : 'Vehículo personal'
  }
  if (v.type === 'charter') return 'Charter'
  return `Uber ${v.id.replace('uber_', '')}`
}

function frescosText(fb, event) {
  const lines = [
    `FRESCOS — ${fb.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete contratado'}`,
    `Equipo: ${(fb.assigned_names ?? []).join(', ')}`,
    fb.loading_start_time ? `Inicio de carga CP: ${fb.loading_start_time}` : null,
    `Salida CP: ${fb.departure_from_cp}`,
  ].filter(Boolean)
  if (fb.second_miniflete?.needs_second_miniflete) {
    lines.push(`Segundo miniflete: Sí (${fb.second_miniflete.reason})`)
    lines.push('Sale junto con el vehículo principal')
  }
  if (event?.hora_inicio) lines.push(`Hora evento: ${event.hora_inicio}`)
  return lines.join('\n')
}

function transportText(tb, pendingEmployee) {
  const lines = [
    `TRASLADO — PE: ${tb.meeting_point?.name ?? ''}`,
    `Salida PE: ${tb.departure_from_pe}`,
  ]
  for (const v of tb.vehicles ?? []) {
    if (v.type === 'personal') {
      if (v.driver) lines.push(`Chofer: ${v.driver}`)
      if (v.passengers_pe?.length) lines.push(`PE: ${v.passengers_pe.join(', ')}`)
      if (v.pickup?.passengers?.length) {
        lines.push(`Pickup: ${v.pickup.passengers.join(', ')}`)
      }
    } else if (v.type === 'charter') {
      if (v.passengers_pe?.length) lines.push(`Charter PE: ${v.passengers_pe.join(', ')}`)
      for (let i = 0; i < (v.pickups?.length ?? 0); i++) {
        const pu = v.pickups[i]
        const ptName = pu.point?.place_name || pu.point?.place_address || ''
        lines.push(`Recogida ${i + 1}${ptName ? ` (${ptName})` : ''}: ${pu.passengers.join(', ')}`)
      }
    } else {
      const peName = v.meeting_point?.name || v.meeting_point?.address || tb.meeting_point?.name || ''
      lines.push(`${vehicleDisplayName(v)} (PE: ${peName}): ${(v.passengers_pe ?? []).join(', ')}`)
      if (v.pickup?.passengers?.length) {
        lines.push(`  Pickup: ${v.pickup.passengers.join(', ')}`)
      }
    }
  }
  if (pendingEmployee) {
    lines.push(`Pendiente (transporte alternativo): ${pendingEmployee}`)
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
        <p className="text-xs font-semibold">Salida: {departureTime}</p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
    } catch {}
  }
  return (
    <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleCopy}>
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

  const fb    = finalOut.frescos_block
  const tb    = finalOut.transport_block
  const staff = state.excelData?.staff ?? []
  const event = state.excelData?.event ?? {}

  const isCharter        = state.charterMode
  const charterCompany   = state.selectedCharterCompany

  // Pickup timing lives on the personal vehicle's route (frontend state).
  const statePersonal    = state.vehicles.find((v) => v.type === 'personal')
  const pickupLegSeconds = statePersonal?.route?.leg_seconds ?? null
  const pickupBeforePe   = statePersonal?.route?.pickup_before_pe ?? null

  // pending_employee in state is a string; also available from tb if needed.
  const pendingEmployee = state.pending_employee ?? tb.pending_employee ?? null

  // ── Frescos breakdown ────────────────────────────────────────────────────
  const cpBd     = fb.departure_breakdown
  const cpTravel = cpBd
    ? cpTravelMinutes(
        cpBd.total_minutes_before_event,
        cpBd.extra_prep_applied,
        cpBd.loading_time_minutes ?? LOADING_TIME_MINUTES,
      )
    : null

  // ── Transport breakdown ──────────────────────────────────────────────────
  const peBd       = tb.departure_breakdown
  const peBdDetail = peBd?.breakdown

  // ── "Volver a editar" ────────────────────────────────────────────────────
  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_OUTPUT,  payload: false })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.30)',
          zIndex: 40, pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'fixed', left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '85vw', height: '85vh', zIndex: 50, pointerEvents: 'auto',
        }}
      >
        <Card className="h-full flex flex-col shadow-2xl">

          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-base">Plan de traslado confirmado</CardTitle>
            {(event.fecha || event.hora_inicio || event.tipo) && (
              <p className="text-xs text-muted-foreground">
                {[event.fecha, event.hora_inicio, event.tipo].filter(Boolean).join(' — ')}
              </p>
            )}
          </CardHeader>

          <CardContent className="flex-1 overflow-hidden flex flex-col gap-4 pt-0">

            <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6">

              {/* ── Left: Salida desde CP ────────────────────────────────── */}
              <div className="overflow-y-auto space-y-4 pr-4 border-r border-border">

                <p className="text-sm font-semibold">Salida desde CP</p>

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

                <div className="space-y-1">
                  <SectionTitle>Salida del CP</SectionTitle>
                  {fb.loading_start_time && (
                    <p className="text-xs text-muted-foreground">
                      Inicio de carga:{' '}
                      <span className="font-medium text-foreground">{fb.loading_start_time}</span>
                    </p>
                  )}
                  <DepartureSection departureTime={fb.departure_from_cp}>
                    {cpBd && (
                      <>
                        <BreakdownRow label="Hora evento"   value={event.hora_inicio ?? '—'} />
                        <BreakdownRow label="Prep en venue" value={`${DEPARTURE_PREP_HOURS}h`} />
                        <BreakdownRow
                          label="Tiempo de viaje"
                          value={`${cpTravel} min`}
                          note="calculado con tráfico real al arribo"
                        />
                        <BreakdownRow label="Buffer"        value={`${DEPARTURE_BUFFER_MINUTES} min`} />
                        <BreakdownRow
                          label="Carga en CP"
                          value={`${cpBd.loading_time_minutes ?? LOADING_TIME_MINUTES} min`}
                        />
                        {cpBd.extra_prep_applied && (
                          <BreakdownRow
                            label={`Extra prep (${(cpBd.extra_prep_reason ?? []).join(', ')})`}
                            value={`${LONG_EVENT_EXTRA_HOURS}h`}
                            amber
                          />
                        )}
                        <div className="border-t border-border pt-1 space-y-1">
                          <BreakdownRow
                            label="Total antes del evento"
                            value={`${cpBd.total_minutes_before_event} min`}
                          />
                          <BreakdownRow label="Inicio de carga" value={fb.loading_start_time ?? '—'} />
                          <BreakdownRow label="Salida del CP"   value={fb.departure_from_cp ?? '—'} />
                        </div>
                      </>
                    )}
                  </DepartureSection>
                </div>

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

                <p className="text-sm font-semibold">
                  {isCharter && charterCompany
                    ? `Charter — ${charterCompany}`
                    : 'Salida desde Punto de Encuentro'
                  }
                </p>

                <div className="space-y-0.5">
                  <SectionTitle>Punto de encuentro</SectionTitle>
                  <p className="text-xs font-medium">{tb.meeting_point?.name}</p>
                  {tb.meeting_point?.address && (
                    <p className="text-xs text-muted-foreground">{tb.meeting_point.address}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <SectionTitle>Salida del PE</SectionTitle>
                  <DepartureSection departureTime={tb.departure_from_pe}>
                    {peBdDetail && (
                      <>
                        <BreakdownRow label="Hora evento"   value={peBdDetail.event_time ?? '—'} />
                        <BreakdownRow label="Prep en venue" value={`${peBdDetail.prep_hours}h`} />
                        <BreakdownRow
                          label="Tiempo de viaje"
                          value={`${peBdDetail.travel_minutes} min`}
                          note="calculado con tráfico real al arribo"
                        />
                        <BreakdownRow label="Buffer" value={`${peBdDetail.buffer_minutes} min`} />
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

                {/* ── Vehicles ─────────────────────────────────────────── */}
                {(tb.vehicles ?? []).map((v) => {
                  const colors = VEHICLE_COLORS[v.id] ?? VEHICLE_COLORS.uber_1
                  const pickupPassengers = v.pickup?.passengers ?? []
                  const pePassengers     = v.passengers_pe ?? []

                  if (v.type === 'personal') {
                    const vPickupInfo = computePickupInfo(tb.departure_from_pe, pickupLegSeconds, pickupBeforePe)
                    return (
                      <div key={v.id} className="space-y-1">
                        <SectionTitle>{vehicleDisplayName(v)}</SectionTitle>

                        {v.driver && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                              <span className="text-xs">
                                {v.driver}
                                {getProfesion(v.driver, staff) ? ` — ${getProfesion(v.driver, staff)}` : ''}
                                <span className="text-muted-foreground"> (chofer)</span>
                              </span>
                            </div>
                          </>
                        )}

                        {pePassengers.length > 0 && (
                          <>
                            {pickupPassengers.length > 0 && (
                              <p className="text-xs text-muted-foreground">Se dirigen al PE:</p>
                            )}
                            {pePassengers.map((name) => (
                              <div key={name} className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                                <span className="text-xs">
                                  {name}
                                  {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                                </span>
                              </div>
                            ))}
                          </>
                        )}

                        {pickupPassengers.length > 0 && (
                          <div className="pt-0.5 space-y-0.5">
                            <p className="text-xs text-muted-foreground">
                              Pickup
                              {statePersonal?.pickup?.point?.place_name
                                ? ` (${statePersonal.pickup.point.place_name})`
                                : ''}:
                            </p>
                            {pickupPassengers.map((name) => (
                              <div key={name} className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-[#7B1FA2] shrink-0" />
                                <span className="text-xs">
                                  {name}
                                  {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                                </span>
                              </div>
                            ))}
                            {statePersonal?.pickup?.point?.place_address && (
                              <p className="text-xs text-muted-foreground pl-3.5">
                                {statePersonal.pickup.point.place_address}
                              </p>
                            )}
                            {vPickupInfo.time ? (
                              <p className="text-xs font-medium pl-3.5">
                                Hora en punto de pickup: {vPickupInfo.time}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground pl-3.5">
                                Horario a confirmar
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground pl-3.5">
                              {vPickupInfo.label}
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  }

                  // Charter vehicle — uses pickups[] array instead of single pickup
                  if (v.type === 'charter') {
                    const charterPickupInfo = computePickupInfo(
                      tb.departure_from_pe,
                      v.route?.leg_seconds   ?? null,
                      v.route?.pickup_before_pe ?? null,
                    )
                    return (
                      <div key={v.id} className="space-y-1">
                        <SectionTitle>Charter</SectionTitle>

                        {pePassengers.length > 0 && (
                          <>
                            {v.pickups.length > 0 && (
                              <p className="text-xs text-muted-foreground">Suben en el PE:</p>
                            )}
                            {pePassengers.map((name) => (
                              <div key={name} className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-[#FBBC04] shrink-0" />
                                <span className="text-xs">
                                  {name}
                                  {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                                </span>
                              </div>
                            ))}
                          </>
                        )}

                        {v.pickups.map((pu, idx) => (
                          <div key={idx} className="pt-0.5 space-y-0.5">
                            <p className="text-xs text-muted-foreground">
                              Recogida {idx + 1}
                              {pu.point?.place_name ? ` (${pu.point.place_name})` : ''}:
                            </p>
                            {pu.passengers.map((name) => (
                              <div key={name} className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-[#444444] shrink-0" />
                                <span className="text-xs">
                                  {name}
                                  {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                                </span>
                              </div>
                            ))}
                            {pu.point?.place_address && (
                              <p className="text-xs text-muted-foreground pl-3.5">
                                {pu.point.place_address}
                              </p>
                            )}
                            {v.pickups.length === 1 && charterPickupInfo.time ? (
                              <p className="text-xs font-medium pl-3.5">
                                Hora en punto de recogida: {charterPickupInfo.time}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground pl-3.5">
                                Horario a confirmar
                              </p>
                            )}
                            {v.pickups.length === 1 && (
                              <p className="text-xs text-muted-foreground pl-3.5">
                                {charterPickupInfo.label}
                              </p>
                            )}
                          </div>
                        ))}

                        {pePassengers.length === 0 && v.pickups.length === 0 && (
                          <p className="text-xs text-muted-foreground">Sin pasajeros</p>
                        )}
                      </div>
                    )
                  }

                  // Uber vehicle
                  const peName = v.meeting_point?.name || v.meeting_point?.address || tb.meeting_point?.name
                  return (
                    <div key={v.id} className="space-y-0.5">
                      <SectionTitle>
                        {vehicleDisplayName(v)}
                        {v.custom_meeting_point ? ` — PE: ${peName}` : ''}
                      </SectionTitle>
                      {!v.custom_meeting_point && (
                        <p className="text-xs text-muted-foreground">PE: {peName}</p>
                      )}
                      {pePassengers.map((name) => (
                        <div key={name} className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: colors.passengers }}
                          />
                          <span className="text-xs">
                            {name}
                            {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                          </span>
                        </div>
                      ))}
                      {pickupPassengers.map((name) => (
                        <div key={name} className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: colors.pickup }}
                          />
                          <span className="text-xs">
                            {name}
                            {getProfesion(name, staff) ? ` — ${getProfesion(name, staff)}` : ''}
                          </span>
                        </div>
                      ))}
                      {pePassengers.length === 0 && pickupPassengers.length === 0 && (
                        <p className="text-xs text-muted-foreground">Sin pasajeros</p>
                      )}
                    </div>
                  )
                })}

                {/* Pending employee */}
                {pendingEmployee && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-2 space-y-1">
                    <SectionTitle>Pendiente</SectionTitle>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-xs">
                        {pendingEmployee}
                        {getProfesion(pendingEmployee, staff)
                          ? ` — ${getProfesion(pendingEmployee, staff)}`
                          : ''}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700">Transporte alternativo a coordinar</p>
                  </div>
                )}

                <CopyButton text={transportText(tb, pendingEmployee)} />
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
