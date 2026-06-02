/**
 * CharterPanel.jsx
 * Centered floating card shown at step 1 when remaining pool status is "charter".
 *
 * Mounts as a fixed overlay (not a sidebar) so the manager sees it clearly
 * without losing the map context.  Fetches the nearest meeting point from the
 * backend, shows charter company phone numbers as tel: links, and provides a
 * "Continuar" button that sets the PE in state and advances to charter step 3.
 */

import { useState, useEffect } from 'react'
import { useAppState, ACTIONS } from '../../state/appState'
import { nearestMeetingPoint }  from '../../api/endpoints'

const CHARTER_PHONES = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

export default function CharterPanel() {
  const { state, dispatch } = useAppState()
  const pool  = state.remainingPool
  const count = pool?.remaining_count ?? pool?.remaining_pool?.length ?? 0

  const [peInfo,    setPeInfo]    = useState(state.meetingPoint ?? null)
  const [peLoading, setPeLoading] = useState(!state.meetingPoint)
  const [peError,   setPeError]   = useState(null)

  useEffect(() => {
    // Reuse already-fetched PE if available (e.g. after STEP_BACK returns here).
    if (state.meetingPoint) {
      setPeInfo(state.meetingPoint)
      setPeLoading(false)
      return
    }
    setPeLoading(true)
    nearestMeetingPoint()
      .then((data) => {
        setPeInfo(data)
        dispatch({ type: ACTIONS.SET_MEETING_POINT, payload: data })
      })
      .catch(() => setPeError('No se pudo obtener el punto de encuentro.'))
      .finally(() => setPeLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleContinue() {
    if (!peInfo) return
    dispatch({ type: ACTIONS.SET_MEETING_POINT,        payload: peInfo })
    dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT, payload: peInfo })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP,         payload: 3 })
  }

  const canContinue = !!peInfo && !peLoading

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
          position:    'fixed',
          top:         '50%',
          left:        '50%',
          transform:   'translate(-50%, -50%)',
          zIndex:      50,
          width:       460,
          maxWidth:    'calc(100vw - 32px)',
          background:  '#fff',
          borderRadius: 14,
          boxShadow:   '0 20px 60px rgba(0,0,0,0.22)',
          overflow:    'hidden',
          animation:   'fadeIn 200ms ease-out',
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
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* PE suggestion */}
          <div>
            <p style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 10px',
            }}>
              Punto de encuentro sugerido
            </p>

            {peLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  display: 'inline-block', width: 16, height: 16,
                  border: '2px solid #e5e7eb', borderTopColor: '#111827',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, color: '#6b7280' }}>Calculando punto más cercano…</span>
              </div>
            )}

            {peError && (
              <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>{peError}</p>
            )}

            {peInfo && !peLoading && (
              <div style={{
                padding:      '14px 16px',
                background:   '#f9fafb',
                border:       '1px solid #e5e7eb',
                borderRadius: 10,
              }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
                  📍 {peInfo.name}
                </p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
                  {peInfo.address}
                </p>
                {peInfo.duration_seconds != null && (
                  <p style={{ fontSize: 12, color: '#9ca3af', margin: '6px 0 0' }}>
                    ~{Math.ceil(peInfo.duration_seconds / 60)} min desde CP
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Charter phone list */}
          <div>
            <p style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 10px',
            }}>
              Servicios de charter
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
                  <a
                    href={`tel:${item.phone.replace(/[\s()-]/g, '')}`}
                    style={{
                      fontSize:       13,
                      color:          '#1D4ED8',
                      fontFamily:     'monospace',
                      fontWeight:     500,
                      textDecoration: 'none',
                    }}
                  >
                    {item.phone}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb' }}>
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            style={{
              width:        '100%',
              padding:      '12px 20px',
              background:   canContinue ? '#111827' : '#e5e7eb',
              color:        canContinue ? '#fff'     : '#9ca3af',
              border:       'none',
              borderRadius: 8,
              fontSize:     14,
              fontWeight:   600,
              cursor:       canContinue ? 'pointer' : 'default',
              transition:   'background 150ms ease',
            }}
            onMouseEnter={(e) => { if (canContinue) e.currentTarget.style.background = '#374151' }}
            onMouseLeave={(e) => { if (canContinue) e.currentTarget.style.background = '#111827' }}
          >
            Continuar →
          </button>
        </div>
      </div>
    </>
  )
}
