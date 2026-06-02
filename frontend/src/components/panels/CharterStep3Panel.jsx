/**
 * CharterStep3Panel.jsx
 * Left panel for charter step 3.
 *
 * Shows: PE info, up to 2 optional pickup points (selected via map click),
 * charter company contacts, and a "Finalizar" button that displays an inline
 * summary confirming the plan.
 *
 * The panel does NOT perform any vehicle assignment or Uber routing — the
 * charter bus carries everyone from the PE (plus optional pickup stops).
 */

import { useState }            from 'react'
import { useAppState, ACTIONS } from '../../state/appState'

const CHARTER_PHONES = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

// ---------------------------------------------------------------------------
// Summary — inline confirmation shown after "Finalizar"
// ---------------------------------------------------------------------------

function CharterSummary({ pe, pickups, count, onBack }) {
  const filledPickups = pickups.filter(Boolean)
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

      <div style={{
        padding:      '14px 16px',
        background:   '#f0fdf4',
        border:       '1px solid #bbf7d0',
        borderRadius: 10,
        marginBottom: 16,
      }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#15803d', margin: '0 0 4px' }}>
          ✓ Plan de charter confirmado
        </p>
        <p style={{ fontSize: 13, color: '#166534', margin: 0 }}>
          {count} personas — traslado grupal coordinado
        </p>
      </div>

      {pe && (
        <div style={{ marginBottom: 16 }}>
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 6px',
          }}>
            Punto de encuentro
          </p>
          <div style={{ padding: '10px 14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>📍 {pe.name}</p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>{pe.address}</p>
          </div>
        </div>
      )}

      {filledPickups.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 6px',
          }}>
            Puntos de recogida
          </p>
          {filledPickups.map((pt, i) => (
            <div key={i} style={{ padding: '10px 14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                Pickup {i + 1}: {pt.name ?? pt.address}
              </p>
              {pt.address && pt.address !== pt.name && (
                <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>{pt.address}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <p style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 6px',
        }}>
          Contactos de charter
        </p>
        {CHARTER_PHONES.map((item) => (
          <div key={item.name} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb',
            borderRadius: 6, marginBottom: 6,
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{item.name}</span>
            <a
              href={`tel:${item.phone.replace(/[\s()-]/g, '')}`}
              style={{ fontSize: 12, color: '#1D4ED8', fontFamily: 'monospace', fontWeight: 500, textDecoration: 'none' }}
            >
              {item.phone}
            </a>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', margin: '0 0 14px', lineHeight: 1.5 }}>
        Coordinar horario de salida y tarifa directamente con la empresa de charter.
      </p>

      <button
        onClick={onBack}
        style={{
          fontSize: 13, color: '#6b7280', background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        ← Volver a editar
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CharterStep3Panel() {
  const { state, dispatch } = useAppState()
  const [showSummary, setShowSummary] = useState(false)

  const pool    = state.remainingPool
  const count   = pool?.remaining_count ?? pool?.remaining_pool?.length ?? 0
  const pe      = state.meetingPoint
  const pickups = state.charterPickupPoints ?? []

  function handleAddPickup(slotIndex) {
    dispatch({ type: ACTIONS.SET_CHARTER_PICKUP_MODE, payload: { active: true, slotIndex } })
  }

  function handleRemovePickup(slotIndex) {
    dispatch({ type: ACTIONS.REMOVE_CHARTER_PICKUP, payload: { slotIndex } })
    dispatch({ type: ACTIONS.SET_CHARTER_PICKUP_MODE, payload: { active: false, slotIndex: null } })
  }

  function handleCancelPickupMode() {
    dispatch({ type: ACTIONS.SET_CHARTER_PICKUP_MODE, payload: { active: false, slotIndex: null } })
  }

  return (
    <div
      style={{
        width:         380,
        flexShrink:    0,
        height:        '100vh',
        background:    '#fff',
        boxShadow:     '2px 0 10px rgba(0,0,0,0.08)',
        display:       'flex',
        flexDirection: 'column',
        zIndex:        10,
        animation:     'slideInFromLeft 220ms ease-out',
      }}
    >
      {/* Header */}
      <div style={{ padding: '15px 20px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Charter — {count} personas
        </h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '3px 0 0' }}>
          Traslado grupal coordinado
        </p>
      </div>

      {showSummary ? (
        <CharterSummary
          pe={pe}
          pickups={pickups}
          count={count}
          onBack={() => setShowSummary(false)}
        />
      ) : (
        <>
          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

            {/* PE info */}
            {pe && (
              <div style={{ marginBottom: 20 }}>
                <p style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
                }}>
                  Punto de encuentro
                </p>
                <div style={{
                  padding: '12px 14px', background: '#f9fafb',
                  border: '1px solid #e5e7eb', borderRadius: 8,
                }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>
                    📍 {pe.name}
                  </p>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
                    {pe.address}
                  </p>
                </div>
              </div>
            )}

            {/* Pickup slots (up to 2) */}
            <div style={{ marginBottom: 20 }}>
              <p style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
              }}>
                Puntos de recogida en ruta (opcional, máx. 2)
              </p>

              {[0, 1].map((slotIndex) => {
                const pt      = pickups[slotIndex]
                const isActive = state.charterPickupMode?.active &&
                                 state.charterPickupMode?.slotIndex === slotIndex
                return (
                  <div key={slotIndex} style={{ marginBottom: 8 }}>
                    {pt ? (
                      <div style={{
                        padding:      '10px 14px',
                        background:   '#f0fdf4',
                        border:       '1px solid #bbf7d0',
                        borderRadius: 8,
                        display:      'flex',
                        alignItems:   'flex-start',
                        gap:          8,
                      }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                            Pickup {slotIndex + 1}: {pt.name ?? pt.address}
                          </p>
                          {pt.address && pt.address !== pt.name && (
                            <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                              {pt.address}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemovePickup(slotIndex)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#9ca3af', fontSize: 16, lineHeight: 1,
                            padding: '0 2px', flexShrink: 0,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAddPickup(slotIndex)}
                        disabled={isActive}
                        style={{
                          width:        '100%',
                          padding:      '10px 14px',
                          background:   isActive ? '#eff6ff' : '#f9fafb',
                          color:        isActive ? '#1d4ed8' : '#374151',
                          border:       `1px ${isActive ? 'solid #93c5fd' : 'dashed #d1d5db'}`,
                          borderRadius: 8,
                          fontSize:     13,
                          cursor:       isActive ? 'default' : 'pointer',
                          textAlign:    'left',
                          transition:   'background 120ms ease',
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#f3f4f6' }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = '#f9fafb' }}
                      >
                        {isActive
                          ? '📍 Clic en el mapa para elegir el punto…'
                          : `+ Agregar punto de recogida ${slotIndex + 1}`}
                      </button>
                    )}
                  </div>
                )
              })}

              {state.charterPickupMode?.active && (
                <button
                  onClick={handleCancelPickupMode}
                  style={{
                    display:        'block',
                    fontSize:       12,
                    color:          '#6b7280',
                    background:     'none',
                    border:         'none',
                    padding:        '4px 0',
                    cursor:         'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Cancelar selección
                </button>
              )}
            </div>

            {/* Charter phone list */}
            <div>
              <p style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
              }}>
                Contactos de charter
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {CHARTER_PHONES.map((item) => (
                  <div key={item.name} style={{
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'space-between',
                    padding:        '8px 12px',
                    background:     '#f9fafb',
                    border:         '1px solid #e5e7eb',
                    borderRadius:   6,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{item.name}</span>
                    <a
                      href={`tel:${item.phone.replace(/[\s()-]/g, '')}`}
                      style={{ fontSize: 12, color: '#1D4ED8', fontFamily: 'monospace', fontWeight: 500, textDecoration: 'none' }}
                    >
                      {item.phone}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', margin: '0 0 10px', lineHeight: 1.5 }}>
              Coordinar horario de salida con la empresa de charter antes de confirmar.
            </p>
            <button
              onClick={() => setShowSummary(true)}
              style={{
                width:        '100%',
                padding:      '11px 16px',
                background:   '#111827',
                color:        '#fff',
                border:       'none',
                borderRadius: 8,
                fontSize:     14,
                fontWeight:   500,
                cursor:       'pointer',
                transition:   'background 150ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#374151' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#111827' }}
            >
              Finalizar ✓
            </button>
          </div>
        </>
      )}
    </div>
  )
}
