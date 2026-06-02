/**
 * CharterPanel.jsx
 * Centered floating card shown at step 1 when remaining pool status is "charter".
 *
 * Displays charter company contacts (plain text — no tel: links) and a
 * "Continuar" button that advances to step 2, where CharterPeSelectionPanel
 * handles meeting-point selection and route computation.
 *
 * No backend calls are made here — that responsibility was moved to step 2.
 */

import { useAppState, ACTIONS } from '../../state/appState'

const CHARTER_PHONES = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

export default function CharterPanel() {
  const { state, dispatch } = useAppState()
  const pool  = state.remainingPool
  const count = pool?.remaining_count ?? pool?.remaining_pool?.length ?? 0

  function handleContinue() {
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 2 })
  }

  return (
    <>
      {/* Backdrop — non-interactive (map stays usable behind it) */}
      <div
        style={{
          position:      'fixed',
          inset:         0,
          background:    'rgba(0,0,0,0.22)',
          zIndex:        40,
          pointerEvents: 'none',
        }}
      />

      {/* Card */}
      <div
        style={{
          position:     'fixed',
          top:          '50%',
          left:         '50%',
          transform:    'translate(-50%, -50%)',
          zIndex:       50,
          width:        460,
          maxWidth:     'calc(100vw - 32px)',
          background:   '#fff',
          borderRadius: 14,
          boxShadow:    '0 20px 60px rgba(0,0,0,0.22)',
          overflow:     'hidden',
          animation:    'fadeIn 200ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>
            Servicio de charter requerido
          </h2>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
            El equipo de{' '}
            <strong style={{ color: '#111827' }}>{count} personas</strong>{' '}
            será trasladado en charter
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 10px',
          }}>
            Empresas de charter disponibles
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CHARTER_PHONES.map((item) => (
              <div
                key={item.name}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  padding:        '10px 14px',
                  background:     '#f9fafb',
                  border:         '1px solid #e5e7eb',
                  borderRadius:   8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                  {item.name}
                </span>
                <span style={{ fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>
                  {item.phone}
                </span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', margin: '14px 0 0', lineHeight: 1.5 }}>
            En el siguiente paso podrás elegir el punto de encuentro y los puntos de recogida opcionales.
          </p>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb' }}>
          <button
            onClick={handleContinue}
            style={{
              width:        '100%',
              padding:      '12px 20px',
              background:   '#111827',
              color:        '#fff',
              border:       'none',
              borderRadius: 8,
              fontSize:     14,
              fontWeight:   600,
              cursor:       'pointer',
              transition:   'background 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#374151' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#111827' }}
          >
            Continuar →
          </button>
        </div>
      </div>
    </>
  )
}
