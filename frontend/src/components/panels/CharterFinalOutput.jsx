/**
 * CharterFinalOutput.jsx
 * Full-screen final output shown after confirming a charter plan.
 *
 * Two-column layout:
 *  Left:  Frescos vehicle info (from state.frescosResult — no /final-output call).
 *  Right: Charter transport plan (company, PE, pickups, departure time).
 *
 * "Volver a editar" → back to step 3 with all state preserved.
 */

import { useAppState, ACTIONS } from '../../state/appState'

const CHARTER_COMPANIES = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeToMinutes(timeStr) {
  if (!timeStr) return null
  const parts = timeStr.split(':').map(Number)
  if (parts.length < 2 || parts.some(isNaN)) return null
  return parts[0] * 60 + parts[1]
}

function minutesToTime(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function computeCharterDeparture(horaInicio, durationSeconds) {
  const eventMinutes = timeToMinutes(horaInicio)
  if (eventMinutes == null || durationSeconds == null) return null
  const travelMinutes = Math.ceil(durationSeconds / 60)
  return minutesToTime(eventMinutes - 4 * 60 - travelMinutes - 10)
}

function getCompanyPhone(name) {
  return CHARTER_COMPANIES.find((c) => c.name === name)?.phone ?? null
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CharterFinalOutput() {
  const { state, dispatch } = useAppState()

  const ca         = state.charterAssignment
  const fr         = state.frescosResult
  const event      = state.excelData?.event
  const horaInicio = event?.hora_inicio
  const departure  = computeCharterDeparture(horaInicio, ca.route?.duration_seconds)
  const departurePoint = ca.custom_departure ?? ca.meeting_point
  const companyPhone = ca.selected_company ? getCompanyPhone(ca.selected_company) : null

  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_OUTPUT, payload: false })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,  payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  return (
    <>
      {/* Semi-transparent backdrop — map stays visible behind */}
      <div
        style={{
          position:   'fixed',
          inset:      0,
          background: 'rgba(0,0,0,0.48)',
          zIndex:     40,
          pointerEvents: 'none',
        }}
      />

      {/* Main panel */}
      <div
        style={{
          position:     'fixed',
          top:          '50%',
          left:         '50%',
          transform:    'translate(-50%, -50%)',
          zIndex:       50,
          width:        '85vw',
          maxWidth:     900,
          maxHeight:    '85vh',
          background:   '#fff',
          borderRadius: 16,
          boxShadow:    '0 24px 80px rgba(0,0,0,0.30)',
          display:      'flex',
          flexDirection: 'column',
          overflow:     'hidden',
          animation:    'fadeIn 220ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 28px 14px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
                Plan de charter confirmado
              </h2>
              {event && (
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                  {[event.tipo, event.fecha, event.hora_inicio].filter(Boolean).join(' · ')}
                  {event.direccion_evento ? ` — ${event.direccion_evento}` : ''}
                </p>
              )}
            </div>
            <button
              onClick={handleEdit}
              style={{
                padding:      '8px 16px',
                background:   '#fff',
                color:        '#374151',
                border:       '1px solid #d1d5db',
                borderRadius: 8,
                fontSize:     13,
                fontWeight:   500,
                cursor:       'pointer',
                flexShrink:   0,
                transition:   'background 150ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
            >
              Volver a editar
            </button>
          </div>
        </div>

        {/* Two-column body */}
        <div style={{
          flex:      1,
          overflowY: 'auto',
          display:   'flex',
          gap:       0,
        }}>

          {/* ── Left column: Frescos ───────────────────────────────────── */}
          <div style={{
            flex:          1,
            padding:       '20px 24px',
            borderRight:   '1px solid #e5e7eb',
          }}>
            <ColumnTitle>Salida desde CP</ColumnTitle>

            {fr ? (
              <>
                <InfoBlock title="Vehículo de frescos">
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>
                    {fr.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete contratado'}
                  </p>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                    {(fr.assigned_names ?? []).join(', ')}
                  </p>
                </InfoBlock>

                <InfoBlock title="Tiempo de carga estimado">
                  <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>
                    ~50 min (a confirmar con el equipo)
                  </p>
                </InfoBlock>

                <InfoBlock title="Hora de salida">
                  <p style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>
                    A coordinar — depende del tráfico y la ruta del charter
                  </p>
                </InfoBlock>
              </>
            ) : (
              <p style={{ fontSize: 13, color: '#9ca3af' }}>Sin datos de frescos.</p>
            )}
          </div>

          {/* ── Right column: Charter transport ───────────────────────── */}
          <div style={{ flex: 1, padding: '20px 24px' }}>
            <ColumnTitle>Traslado — Charter</ColumnTitle>

            {/* Company */}
            {ca.selected_company && (
              <InfoBlock title="Empresa">
                <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                  {ca.selected_company}
                </p>
                {companyPhone && (
                  <p style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace', margin: 0 }}>
                    {companyPhone}
                  </p>
                )}
              </InfoBlock>
            )}

            {/* Departure point */}
            {departurePoint && (
              <InfoBlock title="Salida desde">
                <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                  {departurePoint.name ?? ca.meeting_point?.name}
                </p>
                <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                  {departurePoint.address ?? ca.meeting_point?.address}
                </p>
              </InfoBlock>
            )}

            {/* Departure time */}
            <InfoBlock title="Hora de salida estimada">
              {departure
                ? (
                  <>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
                      {departure}
                    </p>
                    <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
                      {ca.route?.duration_seconds
                        ? `${Math.ceil(ca.route.duration_seconds / 60)} min de viaje hasta el evento`
                        : ''
                      }
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>
                    A coordinar con la empresa de charter
                  </p>
                )
              }
            </InfoBlock>

            {/* PE passengers */}
            {ca.pe_passengers.length > 0 && (
              <InfoBlock title={`Punto de encuentro (${ca.pe_passengers.length} personas)`}>
                {ca.pe_passengers.map((name) => (
                  <p key={name} style={{ fontSize: 12, color: '#374151', margin: '2px 0' }}>
                    {name}
                  </p>
                ))}
              </InfoBlock>
            )}

            {/* Pickups */}
            {ca.pickups.map((pu, i) => pu?.point && (
              <InfoBlock key={i} title={`Pickup ${i + 1}: ${pu.point.name ?? pu.point.address}`}>
                {pu.point.address && pu.point.address !== pu.point.name && (
                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 4px' }}>
                    {pu.point.address}
                  </p>
                )}
                {pu.passengers.length > 0
                  ? pu.passengers.map((name) => (
                    <p key={name} style={{ fontSize: 12, color: '#374151', margin: '2px 0' }}>
                      {name}
                    </p>
                  ))
                  : <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>(sin asignados)</p>
                }
              </InfoBlock>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function ColumnTitle({ children }) {
  return (
    <p style={{
      fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.06em', color: '#374151', margin: '0 0 16px',
      borderBottom: '1px solid #e5e7eb', paddingBottom: 8,
    }}>
      {children}
    </p>
  )
}

function InfoBlock({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: '#9ca3af', margin: '0 0 5px',
      }}>
        {title}
      </p>
      {children}
    </div>
  )
}
