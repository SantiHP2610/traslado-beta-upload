/**
 * CharterSummaryPanel.jsx
 * Right panel at step 3 for charter events.
 *
 * Shows the current charter assignment plan (PE passengers, pickup passengers)
 * with remove buttons, and a "Finalizar" button to open the confirmation modal.
 *
 * "Finalizar" is enabled only when all employees are assigned
 * (getCharterUnassigned returns empty).
 */

import { useAppState, ACTIONS, getCharterUnassigned } from '../../state/appState'

export default function CharterSummaryPanel() {
  const { state, dispatch } = useAppState()

  const ca         = state.charterAssignment
  const unassigned = getCharterUnassigned(state)
  const allDone    = unassigned.length === 0 &&
    (state.remainingPool?.remaining_pool?.length ?? 0) > 0

  function handleUnassign(employeeName) {
    dispatch({ type: ACTIONS.UNASSIGN_CHARTER_EMPLOYEE, payload: { employee_name: employeeName } })
  }

  function handleFinalizar() {
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
  }

  return (
    <div
      style={{
        width:         320,
        flexShrink:    0,
        height:        '100vh',
        background:    '#fff',
        boxShadow:     '-2px 0 10px rgba(0,0,0,0.08)',
        display:       'flex',
        flexDirection: 'column',
        zIndex:        10,
        animation:     'slideInFromRight 220ms ease-out',
      }}
    >
      {/* Header */}
      <div style={{ padding: '15px 20px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Plan de charter
        </h1>
        {ca.selected_company && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: '3px 0 0' }}>
            {ca.selected_company}
          </p>
        )}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* PE section */}
        <div style={{ marginBottom: 20 }}>
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
          }}>
            Punto de encuentro
          </p>
          {ca.meeting_point ? (
            <div style={{ padding: '10px 14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>
                {ca.meeting_point.name}
              </p>
              <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                {ca.meeting_point.address}
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 8px' }}>No seleccionado</p>
          )}

          {ca.pe_passengers.length === 0 ? (
            <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>(sin asignados)</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ca.pe_passengers.map((name) => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', background: '#f9fafb',
                  border: '1px solid #e5e7eb', borderRadius: 6,
                }}>
                  <span style={{ fontSize: 12, color: '#111827' }}>{name}</span>
                  <button
                    onClick={() => handleUnassign(name)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 2px',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pickup sections */}
        {ca.pickups.map((pu, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <p style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
            }}>
              Pickup {i + 1}:{pu.point ? ` ${pu.point.name ?? pu.point.address}` : ''}
            </p>
            {pu.point?.address && (
              <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px', lineHeight: 1.4 }}>
                {pu.point.address}
              </p>
            )}

            {pu.passengers.length === 0 ? (
              <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>(sin asignados)</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pu.passengers.map((name) => (
                  <div key={name} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', background: '#f9fafb',
                    border: '1px solid #e5e7eb', borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 12, color: '#111827' }}>{name}</span>
                    <button
                      onClick={() => handleUnassign(name)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 2px',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
        <button
          onClick={handleFinalizar}
          disabled={!allDone}
          style={{
            width:        '100%',
            padding:      '11px 16px',
            background:   allDone ? '#111827' : '#e5e7eb',
            color:        allDone ? '#fff'     : '#9ca3af',
            border:       'none',
            borderRadius: 8,
            fontSize:     14,
            fontWeight:   500,
            cursor:       allDone ? 'pointer' : 'default',
            transition:   'background 150ms ease',
          }}
          onMouseEnter={(e) => { if (allDone) e.currentTarget.style.background = '#374151' }}
          onMouseLeave={(e) => { if (allDone) e.currentTarget.style.background = '#111827' }}
        >
          Finalizar →
        </button>
        {!allDone && (state.remainingPool?.remaining_pool?.length ?? 0) > 0 && (
          <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', margin: '8px 0 0' }}>
            Asigná todos los empleados para continuar
          </p>
        )}
      </div>
    </div>
  )
}
