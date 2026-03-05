/**
 * FinalOutputBlocks.jsx
 * Two independently draggable info blocks shown after the user confirms all
 * assignments.  Both appear simultaneously alongside the ConfirmationModal.
 *
 * ── Block 1 — Frescos ────────────────────────────────────────────────────────
 * Shows the frescos vehicle crew, the departure time from the CP, and an
 * expandable breakdown of every minute subtracted from the event start time.
 * Second miniflete info is appended if one was triggered.
 *
 * ── Block 2 — Traslado ───────────────────────────────────────────────────────
 * Shows the meeting point, the departure time from the PE/PEA, and the same
 * expandable breakdown (without the loading-time row, which is CP-only).
 * Personal vehicle passengers, pickup info, and Uber groups are listed below.
 *
 * ── Why both blocks are independently draggable ────────────────────────────
 * The manager may want to cross-reference Block 1 (frescos departure) against
 * a specific part of the map while Block 2 (staff transport) is anchored
 * elsewhere.  Independent draggability lets them position each block over the
 * map area most relevant to its content.
 *
 * ── Departure breakdown — CP block ───────────────────────────────────────────
 * cp_departure (calculate_departure_time) returns:
 *   { departure_time, extra_prep_applied, extra_prep_reason, total_minutes_before_event }
 * It does NOT include individual component values.  The frontend derives
 * travel_minutes by subtracting the known constants (DEPARTURE_PREP_HOURS,
 * DEPARTURE_BUFFER_MINUTES, LOADING_TIME_MINUTES, LONG_EVENT_EXTRA_HOURS).
 * Hardcoding these four constants here is intentional: they are defined once
 * in config.py and documented in CLAUDE.md; keeping a copy on the frontend
 * for display purposes avoids an extra API call or a new backend field.
 *
 * ── Departure breakdown — PE block ───────────────────────────────────────────
 * pe_departure (calculate_pe_departure_time) returns:
 *   { departure_time, breakdown: { event_time, prep_hours, travel_minutes,
 *     buffer_minutes, extra_prep_hours, extra_prep_reason,
 *     total_minutes_before_event } }
 * The PE breakdown dict is richer and is used directly.
 *
 * ── Pickup departure time — computed on the frontend ─────────────────────────
 * pickup_time = departure_from_pe − transit_time_to_pickup_minutes.
 * This is a simple subtraction that requires no API call — the backend does not
 * need to know about it.  transit_time_to_pickup_minutes was stored in
 * state.assignments.pickup_transit_minutes when the user confirmed the pickup
 * in PickupResultPanel.
 *
 * ── "Copiar" button ────────────────────────────────────────────────────────
 * Copies the block content as plain text for pasting into WhatsApp or email.
 * Uses the Clipboard API (available on localhost and HTTPS — always true here).
 *
 * ── Starting positions ───────────────────────────────────────────────────────
 * Block 1 starts at the bottom-left, Block 2 to its right.  Both start below
 * the ConfirmationModal so all three elements are initially visible.
 */

import { useState }                         from 'react'
import { useAppState }                       from '../../state/appState'
import { useDraggable }                      from '../../hooks/useDraggable'
import { Card, CardContent, CardHeader,
         CardTitle }                         from '@/components/ui/card'
import { Button }                            from '@/components/ui/button'

// ── Config constants mirrored from config.py ──────────────────────────────────
// These are stable values defined in config.py; keeping a copy here for display
// avoids a new endpoint or extra backend field just for the breakdown tooltip.
const DEPARTURE_PREP_HOURS     = 4
const DEPARTURE_BUFFER_MINUTES = 10
const LOADING_TIME_MINUTES     = 50
const LONG_EVENT_EXTRA_HOURS   = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Derive travel_minutes from the CP departure total because cp_departure
// does not include individual component values in its return shape.
function cpTravelMinutes(totalMinutes, extraPrepApplied) {
  return totalMinutes
    - DEPARTURE_PREP_HOURS * 60
    - DEPARTURE_BUFFER_MINUTES
    - LOADING_TIME_MINUTES
    - (extraPrepApplied ? LONG_EVENT_EXTRA_HOURS * 60 : 0)
}

// Pickup departure time — the time the pickup employee must LEAVE HOME so they
// arrive at the pickup venue as the personal car passes.
// Computed as departure_from_pe − transit_time_to_pickup_minutes.
function computePickupTime(departureFromPe, transitMinutes) {
  if (!departureFromPe || transitMinutes == null) return null
  const [h, m]  = departureFromPe.split(':').map(Number)
  const total   = h * 60 + m - transitMinutes
  const wrapped = ((total % 1440) + 1440) % 1440
  const hOut    = Math.floor(wrapped / 60)
  const mOut    = wrapped % 60
  return `${String(hOut).padStart(2, '0')}:${String(mOut).padStart(2, '0')}`
}

// Look up Profesion for a "Nombre Apellido" string in the staff list.
function getProfesion(nameStr, staff) {
  return staff.find((e) => `${e.Nombre} ${e.Apellido}` === nameStr)?.Profesion ?? null
}

// Build a plain-text summary of the frescos block for clipboard copy.
function freshcosText(fb, event) {
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

// Build a plain-text summary of the transport block for clipboard copy.
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

// Expandable departure breakdown section shared by both blocks.
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

// ---------------------------------------------------------------------------
// Draggable block wrapper
// ---------------------------------------------------------------------------

function DraggableBlock({ initialPos, children }) {
  const { pos, onMouseDown } = useDraggable(initialPos)
  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top:  pos.y,
        zIndex: 50,
        width: 300,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <Card className="shadow-2xl bg-background/90 backdrop-blur-sm">
        <CardHeader
          className="pb-1 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown}
        >
          {children[0]}
        </CardHeader>
        <CardContent className="pt-0 max-h-[55vh] overflow-y-auto space-y-3">
          {children.slice(1)}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API requires HTTPS or localhost — this app always runs on one.
      // Silently ignore if it somehow fails (no user-facing alert needed).
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
  const { state } = useAppState()

  const finalOut = state.finalOutput
  if (!finalOut?.frescos_block || !finalOut?.transport_block) return null

  const fb          = finalOut.frescos_block
  const tb          = finalOut.transport_block
  const staff       = state.excelData?.staff ?? []
  const event       = state.excelData?.event ?? {}
  const assignments = state.assignments

  // ── Frescos block breakdown data ────────────────────────────────────────
  const cpBd        = fb.departure_breakdown  // { departure_time, extra_prep_applied, extra_prep_reason, total_minutes_before_event }
  const cpTravel    = cpBd ? cpTravelMinutes(cpBd.total_minutes_before_event, cpBd.extra_prep_applied) : null

  // ── Transport block breakdown data ──────────────────────────────────────
  const peBd        = tb.departure_breakdown        // { departure_time, breakdown: {...} }
  const peBdDetail  = peBd?.breakdown               // { event_time, prep_hours, travel_minutes, buffer_minutes, extra_prep_hours, extra_prep_reason, total_minutes_before_event }

  // ── Pickup time computation ─────────────────────────────────────────────
  const pickupTime  = computePickupTime(
    tb.departure_from_pe,
    assignments?.pickup_transit_minutes,
  )

  // ── Initial positions: bottom-left and bottom-right areas ──────────────
  const leftX  = Math.max(8, Math.round(window.innerWidth  * 0.03))
  const rightX = leftX + 316
  const initY  = Math.max(8, Math.round(window.innerHeight * 0.60))

  return (
    <>
      {/* ──────────────── Block 1: Frescos ──────────────────────────────── */}
      <DraggableBlock initialPos={{ x: leftX, y: initY }}>

        {/* Drag handle (first child → CardHeader) */}
        <CardTitle className="text-sm">🚚 Frescos</CardTitle>

        {/* Body content (remaining children → CardContent) */}
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
          <DepartureSection departureTime={fb.departure_from_cp}>
            {cpBd && (
              <>
                <BreakdownRow label="Hora evento" value={event.hora_inicio ?? '—'} />
                <BreakdownRow label="Prep en venue" value={`${DEPARTURE_PREP_HOURS}h`} />
                <BreakdownRow
                  label="Tiempo de viaje"
                  value={`${cpTravel} min`}
                  note="calculado con tráfico real al arribo"
                />
                <BreakdownRow label="Buffer" value={`${DEPARTURE_BUFFER_MINUTES} min`} />
                <BreakdownRow label="Carga en CP" value={`${LOADING_TIME_MINUTES} min`} />
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

        {fb.second_miniflete?.needs_second_miniflete && (
          <div className="space-y-0.5">
            <SectionTitle>Segundo miniflete</SectionTitle>
            <p className="text-xs text-muted-foreground">{fb.second_miniflete.reason}</p>
            <p className="text-xs text-muted-foreground">Sale junto con el vehículo principal</p>
          </div>
        )}

        <CopyButton text={freshcosText(fb, event)} />

      </DraggableBlock>

      {/* ──────────────── Block 2: Traslado ─────────────────────────────── */}
      <DraggableBlock initialPos={{ x: rightX, y: initY }}>

        {/* Drag handle */}
        <CardTitle className="text-sm">🚗 Traslado</CardTitle>

        {/* Meeting point */}
        <div className="space-y-1">
          <SectionTitle>Punto de encuentro</SectionTitle>
          <p className="text-xs font-medium">{tb.meeting_point?.name}</p>
        </div>

        {/* PE departure */}
        <div className="space-y-1">
          <SectionTitle>Salida del PE</SectionTitle>
          <DepartureSection departureTime={tb.departure_from_pe}>
            {peBdDetail && (
              <>
                <BreakdownRow label="Hora evento" value={peBdDetail.event_time ?? '—'} />
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

        {/* Personal vehicle */}
        {tb.personal_vehicle?.driver && (
          <div className="space-y-1">
            <SectionTitle>Vehículo personal</SectionTitle>
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
            {/* Pickup info */}
            {assignments?.pickup_employee && (
              <div className="pt-0.5 space-y-0.5">
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
                {tb.uber_groups.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Uber {group.group_number} ({group.passengers?.length}{' '}
                    {group.passengers?.length === 1 ? 'pasajero' : 'pasajeros'})
                    {' '}→ {tb.meeting_point?.name}
                  </p>
                )}
                {tb.uber_groups.length === 1 && (
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

        <CopyButton text={transportText(tb, assignments)} />

      </DraggableBlock>
    </>
  )
}
