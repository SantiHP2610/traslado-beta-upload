/**
 * CharterConfirmationModal.jsx
 * Confirmation modal shown when charterMode is true and showModal is true.
 *
 * Lets the manager:
 *  1. Choose the charter company.
 *  2. Review the PE, pickups, and passenger assignments.
 *  3. See an estimated departure time.
 *  4. Review frescos info.
 *  5. Confirm → go to final output (no backend call for charter).
 */

import { useAppState, ACTIONS } from '../../state/appState'

const CHARTER_COMPANIES = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM" into total minutes from midnight. */
function timeToMinutes(timeStr) {
  if (!timeStr) return null
  const parts = timeStr.split(':').map(Number)
  if (parts.length < 2 || parts.some(isNaN)) return null
  return parts[0] * 60 + parts[1]
}

/** Format total minutes back to "HH:MM". */
function minutesToTime(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Compute estimated charter PE departure time.
 * Formula: event_time − 4h − ceil(duration_seconds / 60) − 10min
 */
function computeCharterDeparture(horaInicio, durationSeconds) {
  const eventMinutes = timeToMinutes(horaInicio)
  if (eventMinutes == null || durationSeconds == null) return null
  const travelMinutes = Math.ceil(durationSeconds / 60)
  const departureMinutes = eventMinutes - 4 * 60 - travelMinutes - 10
  return minutesToTime(departureMinutes)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CharterConfirmationModal() {
  const { state, dispatch } = useAppState()

  const ca            = state.charterAssignment
  const fr            = state.frescosResult
  const event         = state.excelData?.event
  const horaInicio    = event?.hora_inicio
  const departure     = computeCharterDeparture(horaInicio, ca.route?.duration_seconds)
  const departurePoint = ca.custom_departure ?? ca.meeting_point

  function handleSelectCompany(name) {
    dispatch({ type: ACTIONS.SET_CHARTER_COMPANY, payload: { company_name: name } })
  }

  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  function handleConfirm() {
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    dispatch({ type: ACTIONS.SET_SHOW_OUTPUT,  payload: true })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position:      'fixed',
          inset:         0,
          background:    'rgba(0,0,0,0.32)',
          zIndex:        40,
          pointerEvents: 'none',
        }}
      />

      {/* Modal card */}
      <div
        style={{
          position:     'fixed',
          top:          '50%',
          left:         '50%',
          transform:    'translate(-50%, -50%)',
          zIndex:       50,
          width:        520,
          maxWidth:     'calc(100vw - 32px)',
          maxHeight:    '85vh',
          background:   '#fff',
          borderRadius: 14,
          boxShadow:    '0 24px 64px rgba(0,0,0,0.26)',
          display:      'flex',
          flexDirection: 'column',
          overflow:     'hidden',
          animation:    'fadeIn 200ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
            Confirmar plan de charter
          </h2>
          {event && (
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              {[event.tipo, event.fecha, event.hora_inicio].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* Body (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── Company selection ─────────────────────────────────────────── */}
          <SectionTitle>Empresa de charter</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {CHARTER_COMPANIES.map((co) => {
              const isSelected = ca.selected_company === co.name
              return (
                <button
                  key={co.name}
                  onClick={() => handleSelectCompany(co.name)}
                  style={{
                    textAlign:    'left',
                    padding:      '12px 14px',
                    background:   isSelected ? '#eff6ff' : '#f9fafb',
                    border:       isSelected ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    borderRadius: 8,
                    cursor:       'pointer',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'space-between',
                    transition:   'border-color 120ms ease',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{co.name}</span>
                  <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>{co.phone}</span>
                </button>
              )
            })}
          </div>

          {/* ── Meeting point ─────────────────────────────────────────────── */}
          <SectionTitle>Punto de encuentro</SectionTitle>
          {ca.meeting_point && (
            <InfoCard>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>
                {ca.meeting_point.name}
              </p>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                {ca.meeting_point.address}
              </p>
            </InfoCard>
          )}
          {departurePoint && ca.custom_departure && (
            <InfoCard style={{ marginTop: 6 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8', margin: '0 0 1px' }}>
                Salida desde:
              </p>
              <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>
                {departurePoint.address}
              </p>
            </InfoCard>
          )}
          <div style={{ marginBottom: 20 }} />

          {/* ── Employees at PE ───────────────────────────────────────────── */}
          {ca.pe_passengers.length > 0 && (
            <>
              <SectionTitle>Empleados en punto de encuentro</SectionTitle>
              <NameList names={ca.pe_passengers} />
              <div style={{ marginBottom: 20 }} />
            </>
          )}

          {/* ── Pickups ───────────────────────────────────────────────────── */}
          {ca.pickups.map((pu, i) => pu?.point && (
            <div key={i} style={{ marginBottom: 20 }}>
              <SectionTitle>Pickup {i + 1}: {pu.point.name ?? pu.point.address}</SectionTitle>
              {pu.point.address && pu.point.address !== pu.point.name && (
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.4 }}>
                  {pu.point.address}
                </p>
              )}
              {pu.passengers.length > 0
                ? <NameList names={pu.passengers} />
                : <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>(sin asignados)</p>
              }
            </div>
          ))}

          {/* ── Estimated departure ───────────────────────────────────────── */}
          <SectionTitle>Hora estimada de salida</SectionTitle>
          <InfoCard>
            {departure
              ? (
                <>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>
                    Salida del PE: {departure} (aprox.)
                  </p>
                  <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                    4h de preparación + {ca.route?.duration_seconds
                      ? `${Math.ceil(ca.route.duration_seconds / 60)} min de viaje`
                      : 'viaje no calculado'
                    } + 10 min de margen
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
                  A coordinar con la empresa de charter
                </p>
              )
            }
          </InfoCard>
          <div style={{ marginBottom: 20 }} />

          {/* ── Frescos summary ───────────────────────────────────────────── */}
          {fr && (
            <>
              <SectionTitle>Vehículo de frescos</SectionTitle>
              <InfoCard>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                  {fr.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete contratado'}
                </p>
                <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                  {(fr.assigned_names ?? []).join(', ')}
                </p>
              </InfoCard>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #e5e7eb', flexShrink: 0,
          display: 'flex', gap: 10,
        }}>
          <button
            onClick={handleEdit}
            style={{
              flex: 1, padding: '11px 16px',
              background: '#fff', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: 8,
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
          >
            Editar
          </button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1, padding: '11px 16px',
              background: '#111827', color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#374151' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#111827' }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Local sub-components (inline styles only — no Tailwind in modals)
// ---------------------------------------------------------------------------

function SectionTitle({ children }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
    }}>
      {children}
    </p>
  )
}

function InfoCard({ children, style }) {
  return (
    <div style={{
      padding: '10px 14px', background: '#f9fafb',
      border: '1px solid #e5e7eb', borderRadius: 8,
      ...style,
    }}>
      {children}
    </div>
  )
}

function NameList({ names }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {names.map((name) => (
        <div key={name} style={{
          padding: '6px 10px', background: '#f9fafb',
          border: '1px solid #e5e7eb', borderRadius: 6,
          fontSize: 12, color: '#111827',
        }}>
          {name}
        </div>
      ))}
    </div>
  )
}
