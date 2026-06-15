/**
 * ConfirmationModal.jsx
 * Step 4 — centered confirmation modal.
 *
 * Reads display data from state.vehicles + state.pending_employee (new model).
 * Sends POST /final-output with the vehicles array payload on confirm.
 *
 * ── Why the modal reads from state, not from the validate response ─────────
 * POST /validate-assignments is a server-side sanity check — its return value
 * is discarded.  All display data already lives in existing state slices.
 *
 * ── What happens after confirmation ──────────────────────────────────────
 * "Confirmar" calls POST /final-output → SET_SHOW_OUTPUT true + SET_SHOW_MODAL
 * false → FinalOutputBlocks takes over.
 */

import { useState, useEffect }   from 'react'
import { useAppState, ACTIONS }  from '../../state/appState'
import { finalOutput, getConfig } from '../../api/endpoints'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((name) => staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)?.Profesion)
    .filter(Boolean)
}

function buildBody(vehicles, pendingEmployee, frescosResult, chosenMeetingPoint, staff, loadingTimeMinutes) {
  const hasOwnVan     = frescosResult?.vehicle === 'camioneta propia'
  const assignedRoles = deriveProfesiones(frescosResult?.assigned_names ?? [], staff)
  return {
    assignments: {
      vehicles: vehicles.map((v) => ({
        id:                   v.id,
        type:                 v.type,
        driver:               v.driver ?? null,
        vehicle_description:  v.vehicle_description ?? null,
        passengers_pe:        v.passengers_pe,
        pickup_passengers:    v.type === 'charter'
          ? (v.pickups ?? []).flatMap((pu) => pu.passengers)
          : (v.pickup?.passengers ?? []),
        meeting_point:        v.meeting_point,
        custom_meeting_point: v.custom_meeting_point,
      })),
      pending_employee: pendingEmployee ?? null,
    },
    assigned_roles:       assignedRoles,
    chosen_meeting_point: {
      name: chosenMeetingPoint.name,
      lat:  chosenMeetingPoint.lat,
      lng:  chosenMeetingPoint.lng,
    },
    has_own_van:          hasOwnVan,
    loading_time_minutes: loadingTimeMinutes,
  }
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

function NameRow({ name, role, color = 'bg-slate-400' }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color} shrink-0`} />
      <span className="text-xs">{name}{role ? ` — ${role}` : ''}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Hardcoded fallback used while the async /config fetch completes (or if it
// fails).  The live list comes from config.py via GET /config.
const CHARTER_PHONES_FALLBACK = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

export default function ConfirmationModal() {
  const { state, dispatch } = useAppState()
  const [confirming, setConfirming] = useState(false)
  const [charterPhones, setCharterPhones] = useState(CHARTER_PHONES_FALLBACK)

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        const list = cfg.charter?.constants?.CHARTER_PHONE_LIST?.value
        if (Array.isArray(list)) setCharterPhones(list)
      })
      .catch(() => {})   // keep fallback on error
  }, [])
  const [loadingTimeMinutes, setLoadingTimeMinutes] = useState(50)

  const {
    vehicles,
    pending_employee,
    frescosResult,
    secondMinifleteResult,
    chosenMeetingPoint,
    meetingPoint,
    peaEvaluation,
    excelData,
    showOutput,
    charterMode,
    selectedCharterCompany,
  } = state

  const staff = excelData?.staff ?? []
  const event = excelData?.event ?? {}

  const isPea    = meetingPoint && chosenMeetingPoint && (
    Math.abs((chosenMeetingPoint?.lat || 0) - (meetingPoint?.lat || 0)) > 0.0001 ||
    Math.abs((chosenMeetingPoint?.lng || 0) - (meetingPoint?.lng || 0)) > 0.0001
  )
  const remuNote = isPea
    ? peaEvaluation?.candidates?.find((c) => c.name === chosenMeetingPoint?.name)
        ?.remuneration_note ?? null
    : null

  const personalVehicle = vehicles.find((v) => v.type === 'personal') ?? null
  const uberVehicles    = vehicles.filter((v) => v.type === 'uber')
  const charterVehicle  = vehicles.find((v) => v.type === 'charter') ?? null

  // Pickup info for the personal vehicle — read from the vehicle's route.
  const personalPickup    = personalVehicle?.pickup ?? null
  const pickupLegSeconds  = personalVehicle?.route?.leg_seconds ?? null
  const pickupBeforePe    = personalVehicle?.route?.pickup_before_pe ?? null

  // Look up Profesion for any name string.
  function getProfesion(name) {
    return staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)?.Profesion ?? null
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  async function handleConfirm() {
    if (!frescosResult || !chosenMeetingPoint) return
    if (charterMode && !selectedCharterCompany) return
    setConfirming(true)
    dispatch({ type: ACTIONS.SET_ERROR, payload: null })

    try {
      const body   = buildBody(vehicles, pending_employee, frescosResult, chosenMeetingPoint, staff, loadingTimeMinutes)
      const result = await finalOutput(body)
      dispatch({ type: ACTIONS.SET_FINAL_OUTPUT, payload: result })
      dispatch({ type: ACTIONS.SET_SHOW_OUTPUT,  payload: true  })
      dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg    = typeof detail === 'object'
        ? (detail.message ?? JSON.stringify(detail))
        : (err?.message ?? 'Error al confirmar asignaciones.')
      dispatch({ type: ACTIONS.SET_ERROR, payload: msg })
    } finally {
      setConfirming(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position:        'fixed',
          inset:           0,
          backgroundColor: 'rgba(0,0,0,0.32)',
          zIndex:          40,
          pointerEvents:   'none',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position:      'fixed',
          top:           '50%',
          left:          '50%',
          transform:     'translate(-50%, -50%)',
          zIndex:        50,
          width:         500,
          maxWidth:      'calc(100vw - 32px)',
          maxHeight:     '80vh',
          background:    '#fff',
          borderRadius:  12,
          boxShadow:     '0 8px 40px rgba(0,0,0,0.22)',
          display:       'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          animation:     'fadeIn 180ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
            Confirmar plan de traslado
          </h2>
          {(event.fecha || event.hora_inicio || event.tipo) && (
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
              {[event.fecha, event.hora_inicio, event.tipo].filter(Boolean).join(' — ')}
            </p>
          )}
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }} className="space-y-4">

          {/* Charter company selection — required before confirming */}
          {charterMode && (
            <div className="space-y-2 pb-3 border-b border-border">
              <SectionTitle>Empresa de charter</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {charterPhones.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => dispatch({ type: ACTIONS.SET_CHARTER_COMPANY, payload: item.name })}
                    style={{
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'space-between',
                      padding:        '10px 12px',
                      background:     selectedCharterCompany === item.name ? '#f0fdf4' : '#f9fafb',
                      border:         selectedCharterCompany === item.name ? '1.5px solid #22c55e' : '1px solid #e5e7eb',
                      borderRadius:   8,
                      cursor:         'pointer',
                      textAlign:      'left',
                      transition:     'border-color 120ms ease',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{item.name}</span>
                    <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>{item.phone}</span>
                  </button>
                ))}
              </div>
              {!selectedCharterCompany && (
                <p className="text-xs text-amber-600">Seleccioná una empresa para continuar</p>
              )}
            </div>
          )}

          {/* Section 1: Frescos + loading time */}
          <div className="space-y-1.5">
            <SectionTitle>Frescos</SectionTitle>
            <p className="text-xs font-medium">
              {frescosResult?.vehicle === 'camioneta propia'
                ? 'Vehículo QH'
                : 'Miniflete contratado'}
            </p>
            {(frescosResult?.assigned_names ?? []).map((name) => (
              <NameRow key={name} name={name} role={getProfesion(name)} color="bg-orange-400" />
            ))}
            {secondMinifleteResult?.needs_second_miniflete && (
              <div className="pt-1 space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground">Segundo miniflete</p>
                <p className="text-xs text-muted-foreground">{secondMinifleteResult.reason}</p>
              </div>
            )}
            <div className="pt-1 space-y-1">
              <p className="text-xs text-muted-foreground font-medium">
                Tiempo estimado de carga (minutos)
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  value={loadingTimeMinutes}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v) && v >= 0) setLoadingTimeMinutes(v)
                  }}
                  disabled={confirming}
                  style={{
                    width: 72, padding: '5px 8px', border: '1px solid #d1d5db',
                    borderRadius: 6, fontSize: 13, textAlign: 'right',
                    outline: 'none', opacity: confirming ? 0.6 : 1,
                  }}
                />
                <span style={{ fontSize: 13, color: '#374151' }}>min</span>
              </div>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
                Ajustá según la cantidad de comensales y tipo de evento
              </p>
            </div>
          </div>

          {/* Section 2: Punto de encuentro */}
          <div className="space-y-1">
            <SectionTitle>Punto de encuentro</SectionTitle>
            <p className="text-xs font-medium">{chosenMeetingPoint?.name}</p>
            {remuNote && <p className="text-xs text-amber-600">{remuNote}</p>}
          </div>

          {/* Section 3: Charter vehicle */}
          {charterVehicle && (() => {
            const charterPickups = Array.isArray(charterVehicle.pickups)
              ? charterVehicle.pickups
              : charterVehicle.pickup?.point
                ? [{ point: charterVehicle.pickup.point, passengers: charterVehicle.pickup?.passengers ?? [] }]
                : []
            return (
              <div className="space-y-1.5">
                <SectionTitle>Charter</SectionTitle>

                {charterVehicle.passengers_pe.length > 0 && (
                  <>
                    {charterPickups.length > 0 && (
                      <p className="text-xs text-muted-foreground pl-3.5">Suben en el PE:</p>
                    )}
                    {charterVehicle.passengers_pe.map((name) => (
                      <NameRow key={name} name={name} role={getProfesion(name)} color="bg-[#FBBC04]" />
                    ))}
                  </>
                )}

                {charterPickups.map((pu, idx) => {
                  const charterLegSecs  = charterVehicle.route?.leg_seconds      ?? null
                  const charterBeforePe = charterVehicle.route?.pickup_before_pe ?? null
                  return (
                    <div key={idx} className="space-y-0.5">
                      <p className="text-xs text-muted-foreground pl-3.5 pt-0.5">
                        Recogida {idx + 1}
                        {pu.point?.place_name ? ` — ${pu.point.place_name}` : ''}:
                      </p>
                      {pu.passengers.map((name) => (
                        <NameRow key={name} name={name} role={getProfesion(name)} color="bg-[#8B5CF6]" />
                      ))}
                      {pu.point?.place_address && (
                        <p className="text-xs text-muted-foreground pl-3.5">
                          {pu.point.place_address}
                        </p>
                      )}
                      {charterLegSecs != null ? (
                        <p className="text-xs text-muted-foreground pl-3.5">
                          {Math.ceil(charterLegSecs / 60)} min{' '}
                          {charterBeforePe ? 'antes' : 'después'} del PE
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground pl-3.5">Horario a confirmar</p>
                      )}
                    </div>
                  )
                })}

                {charterVehicle.passengers_pe.length === 0 && charterPickups.length === 0 && (
                  <p className="text-xs text-muted-foreground pl-3.5">Sin pasajeros</p>
                )}
              </div>
            )
          })()}

          {/* Section 4: Personal vehicle */}
          {personalVehicle && (
            <div className="space-y-1.5">
              <SectionTitle>{vehicleDisplayName(personalVehicle)}</SectionTitle>

              {personalVehicle.driver && (
                <NameRow
                  name={personalVehicle.driver}
                  role={getProfesion(personalVehicle.driver)}
                  color="bg-green-500"
                />
              )}
              {personalVehicle.driver && (
                <p className="text-xs text-green-600 pl-3.5 font-medium -mt-1">Chofer</p>
              )}

              {personalVehicle.passengers_pe.length > 0 && (
                <>
                  {personalPickup?.passengers?.length > 0 && (
                    <p className="text-xs text-muted-foreground pl-3.5 pt-0.5">Se encuentran en el PE:</p>
                  )}
                  {personalVehicle.passengers_pe.map((name) => (
                    <NameRow key={name} name={name} role={getProfesion(name)} color="bg-green-500" />
                  ))}
                </>
              )}

              {personalVehicle.passengers_pe.length === 0 && !personalPickup?.passengers?.length && (
                <p className="text-xs text-muted-foreground pl-3.5">Sin pasajeros</p>
              )}

              {personalPickup?.passengers?.length > 0 && (
                <div className="pl-1 space-y-0.5">
                  <p className="text-xs text-muted-foreground pl-3.5 pt-0.5">
                    Se encuentran en el punto de pickup
                    {personalPickup.point?.place_name ? ` (${personalPickup.point.place_name})` : ''}:
                  </p>
                  {personalPickup.passengers.map((name) => (
                    <NameRow key={name} name={name} role={getProfesion(name)} color="bg-[#8B5CF6]" />
                  ))}
                  {personalPickup.point?.place_address && (
                    <p className="text-xs text-muted-foreground pl-3.5">
                      {personalPickup.point.place_address}
                    </p>
                  )}
                  {pickupLegSeconds != null ? (
                    <p className="text-xs text-muted-foreground pl-3.5">
                      {Math.ceil(pickupLegSeconds / 60)} min{' '}
                      {pickupBeforePe ? 'antes' : 'después'} del PE
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground pl-3.5">Horario a confirmar</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section 4: Uber vehicles */}
          {uberVehicles.length > 0 && (
            <div className="space-y-2">
              <SectionTitle>
                Uber ({uberVehicles.reduce((s, v) => s + v.passengers_pe.length + v.pickup.passengers.length, 0)}{' '}
                pasajeros)
              </SectionTitle>
              {uberVehicles.map((v) => (
                <div key={v.id} className="space-y-0.5">
                  {uberVehicles.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      {vehicleDisplayName(v)}
                      {v.custom_meeting_point && v.meeting_point
                        ? ` — PE: ${v.meeting_point.name || v.meeting_point.address}`
                        : ''}
                    </p>
                  )}
                  {uberVehicles.length === 1 && v.custom_meeting_point && v.meeting_point && (
                    <p className="text-xs text-blue-600">
                      PE: {v.meeting_point.name || v.meeting_point.address}
                    </p>
                  )}
                  {v.passengers_pe.map((name) => (
                    <NameRow key={name} name={name} role={getProfesion(name)} color="bg-slate-400" />
                  ))}
                  {v.pickup.passengers.map((name) => (
                    <NameRow key={name} name={name} role={getProfesion(name)} color="bg-[#8B5CF6]" />
                  ))}
                  {v.passengers_pe.length === 0 && v.pickup.passengers.length === 0 && (
                    <p className="text-xs text-muted-foreground pl-3.5">Sin pasajeros</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Section 5: Pending employee */}
          {pending_employee && (
            <div className="space-y-1 rounded-md bg-amber-50 border border-amber-200 p-2">
              <SectionTitle>Pendiente</SectionTitle>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                <span className="text-xs font-medium">
                  {pending_employee}
                  {getProfesion(pending_employee) ? ` — ${getProfesion(pending_employee)}` : ''}
                </span>
              </div>
              <p className="text-xs text-amber-700">Transporte alternativo a coordinar</p>
            </div>
          )}

          {/* Error */}
          {state.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
        </div>

        {/* Footer buttons */}
        <div
          style={{
            padding: '14px 24px', borderTop: '1px solid #e5e7eb',
            flexShrink: 0, display: 'flex', gap: 10,
          }}
        >
          <button
            onClick={handleEdit}
            disabled={confirming}
            style={{
              flex: 1, padding: '10px 16px', background: '#fff', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 500,
              cursor: confirming ? 'default' : 'pointer', transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => { if (!confirming) e.currentTarget.style.background = '#f9fafb' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
          >
            Editar
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || showOutput}
            style={{
              flex: 2, padding: '10px 16px',
              background: (confirming || showOutput) ? '#374151' : '#111827',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: (confirming || showOutput) ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (!confirming && !showOutput) e.currentTarget.style.background = '#374151'
            }}
            onMouseLeave={(e) => {
              if (!confirming && !showOutput) e.currentTarget.style.background = '#111827'
            }}
          >
            {confirming ? (
              <>
                <span
                  className="animate-spin"
                  style={{
                    display: 'inline-block', width: 14, height: 14,
                    border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                    borderRadius: '50%',
                  }}
                />
                Confirmando...
              </>
            ) : showOutput ? (
              'Confirmado ✓'
            ) : (
              'Confirmar'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
