/**
 * CharterPeSelectionPanel.jsx
 * Sidebar content at step 2 when charterMode is true.
 *
 * Responsibilities:
 *  1. Fetch all 3 PEs via /nearest-meeting-point?all=true and let the manager
 *     select one.
 *  2. Optional: override the departure address with a custom geocoded address.
 *  3. Optional: add up to 2 pickup points via map clicks.
 *  4. On "Continuar": dispatch meeting point to state, compute the charter route
 *     via /simple-route, and advance to step 3.
 */

import { useState, useEffect }                       from 'react'
import { useAppState, ACTIONS }                      from '../../state/appState'
import { nearestMeetingPoint, simpleRoute, geocodeAddress } from '../../api/endpoints'

export default function CharterPeSelectionPanel() {
  const { state, dispatch } = useAppState()

  // All 3 PEs fetched from the backend.
  const [allPes,   setAllPes]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [fetchErr, setFetchErr] = useState(null)

  // Local selected PE (not dispatched until "Continuar").
  const [selectedPe, setSelectedPe] = useState(null)

  // Custom departure address collapsible.
  const [deptOpen,   setDeptOpen]   = useState(false)
  const [deptInput,  setDeptInput]  = useState('')
  const [deptGeo,    setDeptGeo]    = useState(false)    // geocoding in progress
  const [deptErr,    setDeptErr]    = useState(null)

  // Continuing state.
  const [continuing, setContinuing] = useState(false)
  const [continueErr, setContinueErr] = useState(null)

  const ca      = state.charterAssignment
  const pickups = ca.pickups ?? []

  // ── Fetch all PEs on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    nearestMeetingPoint(true)
      .then((data) => {
        // Backend returns { recommended, alternatives[] }
        const all = [data.recommended, ...(data.alternatives ?? [])].filter(Boolean)
        setAllPes(all)
        // Pre-select the recommended PE.
        if (all.length > 0) setSelectedPe(all[0])
      })
      .catch(() => setFetchErr('No se pudo obtener los puntos de encuentro.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Custom departure geocode ───────────────────────────────────────────────
  async function handleGeocodeDeparture() {
    const addr = deptInput.trim()
    if (!addr) return
    setDeptGeo(true)
    setDeptErr(null)
    try {
      const geo = await geocodeAddress(addr)
      const point = {
        name:    addr,
        address: geo.formatted_address ?? addr,
        lat:     geo.lat,
        lng:     geo.lng,
      }
      dispatch({ type: ACTIONS.SET_CHARTER_CUSTOM_DEPARTURE, payload: { address: point } })
    } catch {
      setDeptErr('No se pudo geocodificar la dirección.')
    } finally {
      setDeptGeo(false)
    }
  }

  function handleClearDeparture() {
    dispatch({ type: ACTIONS.SET_CHARTER_CUSTOM_DEPARTURE, payload: { address: null } })
    setDeptInput('')
  }

  // ── Pickup mode toggle ─────────────────────────────────────────────────────
  function handleAddPickup() {
    const index = pickups.length  // next slot index (0 or 1)
    dispatch({ type: ACTIONS.SET_CHARTER_PICKUP_MODE, payload: { active: true, index } })
  }

  function handleRemovePickup(index) {
    dispatch({ type: ACTIONS.REMOVE_CHARTER_PICKUP, payload: { index } })
  }

  function handleCancelPickupMode() {
    dispatch({ type: ACTIONS.SET_CHARTER_PICKUP_MODE, payload: { active: false, index: 0 } })
  }

  // ── Continue ───────────────────────────────────────────────────────────────
  async function handleContinue() {
    if (!selectedPe) return
    setContinuing(true)
    setContinueErr(null)
    try {
      // Dispatch the selected PE to charterAssignment and to the map marker system.
      dispatch({ type: ACTIONS.SET_CHARTER_MEETING_POINT, payload: { meeting_point: selectedPe } })
      dispatch({ type: ACTIONS.SET_MEETING_POINT,         payload: selectedPe })
      dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT,  payload: selectedPe })

      // Compute the charter route: departure point → event venue.
      // Departure point = custom_departure if set, otherwise the selected PE.
      const departure = ca.custom_departure ?? selectedPe
      if (state.eventCoords) {
        try {
          const route = await simpleRoute(
            departure.lat, departure.lng,
            state.eventCoords.lat, state.eventCoords.lng,
          )
          dispatch({ type: ACTIONS.SET_CHARTER_ROUTE, payload: { route } })
        } catch {
          // Route computation failed — continue anyway without a route.
        }
      }

      dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
    } catch (err) {
      setContinueErr(err?.message ?? 'Error al continuar.')
    } finally {
      setContinuing(false)
    }
  }

  const pickupModeActive = state.charterPickupMode?.active
  const canAddPickup     = pickups.length < 2 && !pickupModeActive

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Title ────────────────────────────────────────────────────────── */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
          Punto de encuentro para el charter
        </p>
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          Elegí dónde se reunirá el grupo antes de subir al charter.
        </p>
      </div>

      {/* ── PE list ──────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-block', width: 14, height: 14,
            border: '2px solid #e5e7eb', borderTopColor: '#111827',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0,
          }} />
          <span style={{ fontSize: 13, color: '#6b7280' }}>Cargando puntos de encuentro…</span>
        </div>
      )}

      {fetchErr && (
        <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>{fetchErr}</p>
      )}

      {allPes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allPes.map((pe, idx) => {
            const isSelected   = selectedPe?.name === pe.name
            const isRecommended = idx === 0
            return (
              <button
                key={pe.name}
                onClick={() => setSelectedPe(pe)}
                style={{
                  textAlign:    'left',
                  padding:      '12px 14px',
                  background:   isSelected ? '#eff6ff' : '#f9fafb',
                  border:       isSelected
                    ? '2px solid #2563eb'
                    : isRecommended
                      ? '1px solid #bbf7d0'
                      : '1px solid #e5e7eb',
                  borderRadius: 8,
                  cursor:       'pointer',
                  transition:   'border-color 120ms ease, background 120ms ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                    {pe.name}
                  </span>
                  {isRecommended && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: '#16a34a',
                      background: '#dcfce7', borderRadius: 4, padding: '1px 5px',
                    }}>
                      Recomendado
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                  {pe.address}
                </p>
                {pe.duration_seconds != null && (
                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '3px 0 0' }}>
                    ~{Math.ceil(pe.duration_seconds / 60)} min desde CP
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Custom departure (collapsible) ───────────────────────────────── */}
      <div>
        <button
          onClick={() => setDeptOpen((v) => !v)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 12, color: '#2563eb', textDecoration: 'underline', display: 'flex',
            alignItems: 'center', gap: 4,
          }}
        >
          {deptOpen ? '▾' : '▸'} Editar dirección de partida
        </button>

        {deptOpen && (
          <div style={{ marginTop: 10 }}>
            {ca.custom_departure && (
              <div style={{
                padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: 6, marginBottom: 8,
              }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8', margin: '0 0 2px' }}>
                  Salida personalizada:
                </p>
                <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>
                  {ca.custom_departure.address}
                </p>
                <button
                  onClick={handleClearDeparture}
                  style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, textDecoration: 'underline', marginTop: 4 }}
                >
                  Usar punto de encuentro
                </button>
              </div>
            )}

            <input
              value={deptInput}
              onChange={(e) => setDeptInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGeocodeDeparture() }}
              placeholder="Dirección de partida alternativa"
              style={{
                width: '100%', fontSize: 12, padding: '6px 8px',
                border: '1px solid #d1d5db', borderRadius: 6, outline: 'none',
                boxSizing: 'border-box', marginBottom: 5,
              }}
            />
            {deptErr && (
              <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 4px' }}>{deptErr}</p>
            )}
            <button
              onClick={handleGeocodeDeparture}
              disabled={deptGeo || !deptInput.trim()}
              style={{
                fontSize: 11, padding: '5px 14px',
                background: deptGeo || !deptInput.trim() ? '#e5e7eb' : '#111827',
                color: deptGeo || !deptInput.trim() ? '#9ca3af' : '#fff',
                border: 'none', borderRadius: 6, cursor: deptGeo ? 'default' : 'pointer',
              }}
            >
              {deptGeo ? 'Geocodificando…' : 'Geocodificar'}
            </button>
          </div>
        )}
      </div>

      {/* ── Pickup points (optional, shown after PE selected) ────────────── */}
      {selectedPe && (
        <div>
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px',
          }}>
            Puntos de recogida (opcional, máx. 2)
          </p>

          {/* Confirmed pickups */}
          {pickups.map((pu, i) => (
            <div key={i} style={{
              padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: 8, marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                  Pickup {i + 1}: {pu.point?.name ?? pu.point?.address ?? '(sin nombre)'}
                </p>
                {pu.point?.address && pu.point.address !== pu.point.name && (
                  <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                    {pu.point.address}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleRemovePickup(i)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add pickup button or "active" state */}
          {pickupModeActive ? (
            <div style={{
              padding: '10px 14px', background: '#eff6ff', border: '1px solid #93c5fd',
              borderRadius: 8, marginBottom: 6,
            }}>
              <p style={{ fontSize: 13, color: '#1d4ed8', margin: '0 0 6px', fontWeight: 500 }}>
                Hacé clic en el mapa para agregar el punto de recogida…
              </p>
              <button
                onClick={handleCancelPickupMode}
                style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none',
                  cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Cancelar
              </button>
            </div>
          ) : canAddPickup ? (
            <button
              onClick={handleAddPickup}
              style={{
                width: '100%', padding: '10px 14px',
                background: '#f9fafb', color: '#374151',
                border: '1px dashed #d1d5db', borderRadius: 8,
                fontSize: 13, cursor: 'pointer', textAlign: 'left',
                transition: 'background 120ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb' }}
            >
              + Elegir en mapa
            </button>
          ) : null}
        </div>
      )}

      {/* ── Continue button ───────────────────────────────────────────────── */}
      {continueErr && (
        <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{continueErr}</p>
      )}
      <button
        onClick={handleContinue}
        disabled={!selectedPe || continuing}
        style={{
          width:        '100%',
          padding:      '11px 16px',
          background:   selectedPe && !continuing ? '#111827' : '#e5e7eb',
          color:        selectedPe && !continuing ? '#fff'     : '#9ca3af',
          border:       'none',
          borderRadius: 8,
          fontSize:     14,
          fontWeight:   500,
          cursor:       selectedPe && !continuing ? 'pointer' : 'default',
          transition:   'background 150ms ease',
        }}
        onMouseEnter={(e) => { if (selectedPe && !continuing) e.currentTarget.style.background = '#374151' }}
        onMouseLeave={(e) => { if (selectedPe && !continuing) e.currentTarget.style.background = '#111827' }}
      >
        {continuing ? 'Calculando ruta…' : 'Continuar →'}
      </button>
    </div>
  )
}
