/**
 * Sidebar.jsx
 * Steps 1-2 left sidebar — full height, ~380px wide.
 *
 * Layout:
 *   Fixed header (app title + event summary)
 *   └── Step 1 section: FrescosPanel content
 *       • Before step 1 is done: full content, no collapse
 *       • After step 1 is done: collapsed to a one-line summary with chevron;
 *         clicking the header row expands/collapses inline
 *   └── Step 2 section: PeaPanel content (only visible from step 2)
 *       Fades in below step 1 once currentStep >= 2.
 *   └── UberRoutesSection: appears after PE/PEA is confirmed (chosenMeetingPoint set).
 *       Lets the manager trace a PE→event route for each Uber group before
 *       advancing to step 3.  Once all Ubers have routes the "Continuar" button
 *       enables and dispatches SET_CURRENT_STEP 3.
 */

import { useState, useEffect, useRef }      from 'react'
import { ChevronDown, ChevronRight }        from 'lucide-react'
import { useAppState, ACTIONS, VEHICLE_COLORS } from '../../state/appState'
import { simpleRoute, geocodeAddress, geocodeAndEnrich, nearestMeetingPoint, getConfig } from '../../api/endpoints'
import FrescosPanel                         from './FrescosPanel'
import PeaPanel                             from './PeaPanel'
import { CabaPanel }                        from './CabaPanel'
import { CabaPeSelectionPanel }             from './CabaPeSelectionPanel'

// ---------------------------------------------------------------------------
// EventInfoSection — compact event summary at the top of the sidebar
// ---------------------------------------------------------------------------

function EventInfoSection({ event, services }) {
  const [prestOpen, setPrestOpen] = useState(false)

  if (!event) return null

  const observaciones = Array.isArray(event.observaciones)
    ? event.observaciones
    : event.observaciones
      ? [event.observaciones]
      : []

  return (
    <div
      style={{
        padding:      '12px 20px 14px',
        borderBottom: '1px solid #e5e7eb',
        flexShrink:   0,
      }}
    >
      {(event.fecha || event.hora_inicio) && (
        <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 3px' }}>
          {[event.fecha, event.hora_inicio].filter(Boolean).join(' · ')}
        </p>
      )}
      {event.tipo && (
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px' }}>
          {event.tipo}
          {event.comensales ? ` · ${event.comensales} comensales` : ''}
        </p>
      )}
      {services && services.length > 0 && (
        <div style={{ marginTop: 5 }}>
          <button
            onClick={() => setPrestOpen((v) => !v)}
            style={{
              fontSize:   11,
              color:      '#6b7280',
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              padding:    0,
              display:    'flex',
              alignItems: 'center',
              gap:        3,
            }}
          >
            {prestOpen ? '▾' : '▸'} Ver prestaciones ({services.length})
          </button>
          {prestOpen && (
            <ul style={{ margin: '4px 0 0', padding: '0 0 0 10px', listStyle: 'none' }}>
              {services.map((s, i) => (
                <li key={i} style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
                  {s.Servicio}{s.Detalle ? `: ${s.Detalle}` : ''}{s.Cantidad ? ` (${s.Cantidad})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {event.descripcion_locacion && (
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '5px 0 0', lineHeight: 1.45 }}>
          {event.descripcion_locacion}
        </p>
      )}
      {observaciones.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {observaciones.map((obs, i) => (
            <p key={i} style={{ fontSize: 11, color: '#9ca3af', margin: '1px 0', lineHeight: 1.45 }}>
              {obs}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UberRoutesSection — step 2b: trace PE→event routes for each Uber vehicle
// before advancing to step 3.
//
// Displayed only after chosenMeetingPoint is set (vehicles already initialised
// by the Sidebar useEffect).  One card per Uber vehicle with:
//   • "Trazar desde PE" — calls /simple-route from the ORIGINAL PE (meetingPoint,
//     not the chosen PEA if a PEA was selected — Ubers always depart from the
//     original PE) to the event coords, then dispatches SET_VEHICLE_ROUTE.
//   • "Elegir otro PE" — inline geocode form → SET_VEHICLE_MEETING_POINT + route.
//   • "Volver al PE original" — RESET_VEHICLE_MEETING_POINT.
// "Continuar a asignación →" is enabled once every Uber has a route.
// ---------------------------------------------------------------------------

function UberRoutesSection() {
  const { state, dispatch } = useAppState()

  const [tracingRoute, setTracingRoute] = useState({})   // vehicle_id → bool
  const [editMode,     setEditMode]     = useState({})   // vehicle_id → bool
  const [addrInputs,   setAddrInputs]   = useState({})   // vehicle_id → string
  const [geocoding,    setGeocoding]    = useState({})   // vehicle_id → bool
  const [geoErrors,    setGeoErrors]    = useState({})   // vehicle_id → string
  const [routeErrors,  setRouteErrors]  = useState({})   // vehicle_id → string

  const uberVehicles    = state.vehicles.filter((v) => v.type === 'uber')
  const allHaveRoutes   = uberVehicles.every((v) => v.route !== null)
  const canContinue     = uberVehicles.length === 0 || allHaveRoutes

  async function handleTraceFromPE(vehicleId) {
    if (!state.eventCoords || !state.meetingPoint) return
    setTracingRoute((prev) => ({ ...prev, [vehicleId]: true }))
    setRouteErrors((prev)  => ({ ...prev, [vehicleId]: null  }))
    try {
      const result = await simpleRoute(
        state.meetingPoint.lat, state.meetingPoint.lng,
        state.eventCoords.lat,  state.eventCoords.lng,
      )
      dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: vehicleId, route: result } })
    } catch {
      setRouteErrors((prev) => ({ ...prev, [vehicleId]: 'No se pudo trazar la ruta.' }))
    } finally {
      setTracingRoute((prev) => ({ ...prev, [vehicleId]: false }))
    }
  }

  async function handleGeocode(vehicleId) {
    const address = addrInputs[vehicleId]?.trim() ?? ''
    if (!address) return
    setGeocoding((prev)  => ({ ...prev, [vehicleId]: true  }))
    setGeoErrors((prev)  => ({ ...prev, [vehicleId]: null  }))
    try {
      const result = await geocodeAndEnrich(address)
      if (!result) throw new Error('No result')
      const newMp  = {
        name:    result.name,
        address: result.address,
        lat:     result.lat,
        lng:     result.lng,
      }
      dispatch({ type: ACTIONS.SET_VEHICLE_MEETING_POINT, payload: { vehicle_id: vehicleId, meeting_point: newMp } })
      if (state.eventCoords) {
        const route = await simpleRoute(result.lat, result.lng, state.eventCoords.lat, state.eventCoords.lng)
        dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: vehicleId, route } })
      }
      setEditMode((prev) => ({ ...prev, [vehicleId]: false }))
    } catch {
      setGeoErrors((prev) => ({ ...prev, [vehicleId]: 'No se pudo geocodificar la dirección.' }))
    } finally {
      setGeocoding((prev) => ({ ...prev, [vehicleId]: false }))
    }
  }

  function handleResetToPE(vehicleId) {
    dispatch({ type: ACTIONS.RESET_VEHICLE_MEETING_POINT, payload: { vehicle_id: vehicleId } })
    setEditMode((prev) => ({ ...prev, [vehicleId]: false }))
  }

  const uberLabel = uberVehicles.length === 1
    ? '1 Uber'
    : `${uberVehicles.length} Ubers`

  return (
    <div
      style={{
        padding:      '16px 20px',
        borderTop:    '1px solid #e5e7eb',
        animation:    'fadeIn 200ms ease-out',
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
        Rutas de vehículos{uberVehicles.length > 0 ? ` (${uberLabel})` : ''}
      </p>

      {uberVehicles.length === 0 ? (
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
          No hay Ubers — todos viajan en el vehículo personal.
        </p>
      ) : (
        uberVehicles.map((v) => {
          const uberNum   = v.id.replace('uber_', '')
          const isTracing = tracingRoute[v.id]
          const isGeo     = geocoding[v.id]
          const isEditing = editMode[v.id]
          const hasRoute  = v.route !== null
          const dotColor  = VEHICLE_COLORS[v.id]?.route ?? '#2D2D2D'

          return (
            <div key={v.id} style={{ marginBottom: 16 }}>
              {/* ── Row: color dot + label + status ─────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: dotColor, flexShrink: 0,
                }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: 0 }}>
                  Uber {uberNum}
                </p>
                {hasRoute
                  ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✓ Ruta trazada</span>
                  : <span style={{ fontSize: 11, color: '#9ca3af' }}>○ Sin ruta</span>
                }
              </div>

              {/* ── Custom PE label ──────────────────────────────────────── */}
              {v.custom_meeting_point && (
                <p style={{ fontSize: 11, color: '#2563eb', margin: '0 0 6px 18px', lineHeight: 1.4 }}>
                  📍 {v.meeting_point?.name || v.meeting_point?.address}
                </p>
              )}

              {routeErrors[v.id] && (
                <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 4px 18px' }}>
                  {routeErrors[v.id]}
                </p>
              )}

              {/* ── Action buttons / geocode form ────────────────────────── */}
              {!isEditing ? (
                <div style={{ display: 'flex', gap: 6, marginLeft: 18 }}>
                  <button
                    onClick={() => handleTraceFromPE(v.id)}
                    disabled={isTracing}
                    style={{
                      flex:         1,
                      fontSize:     11,
                      padding:      '5px 0',
                      background:   hasRoute ? '#f3f4f6' : '#111827',
                      color:        hasRoute ? '#374151' : '#fff',
                      border:       hasRoute ? '1px solid #d1d5db' : 'none',
                      borderRadius: 6,
                      cursor:       isTracing ? 'default' : 'pointer',
                      opacity:      isTracing ? 0.7 : 1,
                    }}
                  >
                    {isTracing ? 'Trazando…' : hasRoute ? '↺ Volver a trazar' : 'Trazar desde PE'}
                  </button>
                  <button
                    onClick={() => {
                      setAddrInputs((prev) => ({ ...prev, [v.id]: v.meeting_point?.address ?? '' }))
                      setGeoErrors((prev)  => ({ ...prev, [v.id]: null }))
                      setEditMode((prev)   => ({ ...prev, [v.id]: true }))
                    }}
                    style={{
                      flex:         1,
                      fontSize:     11,
                      padding:      '5px 0',
                      background:   '#fff',
                      color:        '#374151',
                      border:       '1px solid #d1d5db',
                      borderRadius: 6,
                      cursor:       'pointer',
                    }}
                  >
                    Elegir otro PE
                  </button>
                </div>
              ) : (
                <div style={{ marginLeft: 18 }}>
                  <input
                    value={addrInputs[v.id] ?? ''}
                    onChange={(e) => setAddrInputs((prev) => ({ ...prev, [v.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleGeocode(v.id) }}
                    placeholder="Dirección del punto de encuentro"
                    style={{
                      width:        '100%',
                      fontSize:     12,
                      padding:      '5px 8px',
                      border:       '1px solid #d1d5db',
                      borderRadius: 6,
                      outline:      'none',
                      boxSizing:    'border-box',
                      marginBottom: 5,
                    }}
                  />
                  {geoErrors[v.id] && (
                    <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 4px' }}>
                      {geoErrors[v.id]}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <button
                      onClick={() => handleGeocode(v.id)}
                      disabled={isGeo}
                      style={{
                        flex:         1,
                        fontSize:     11,
                        padding:      '5px 0',
                        background:   isGeo ? '#e5e7eb' : '#111827',
                        color:        isGeo ? '#9ca3af' : '#fff',
                        border:       'none',
                        borderRadius: 6,
                        cursor:       isGeo ? 'default' : 'pointer',
                      }}
                    >
                      {isGeo ? 'Buscando…' : 'Buscar'}
                    </button>
                    <button
                      onClick={() => setEditMode((prev) => ({ ...prev, [v.id]: false }))}
                      style={{
                        flex:         1,
                        fontSize:     11,
                        padding:      '5px 0',
                        background:   '#fff',
                        color:        '#374151',
                        border:       '1px solid #d1d5db',
                        borderRadius: 6,
                        cursor:       'pointer',
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                  {v.custom_meeting_point && (
                    <button
                      onClick={() => handleResetToPE(v.id)}
                      style={{
                        display:        'block',
                        width:          '100%',
                        fontSize:       11,
                        padding:        '3px 0',
                        background:     'none',
                        color:          '#6b7280',
                        border:         'none',
                        cursor:         'pointer',
                        textDecoration: 'underline',
                        textAlign:      'center',
                      }}
                    >
                      Volver al PE original
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {/* ── Continue button ───────────────────────────────────────────────── */}
      <button
        onClick={() => dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })}
        disabled={!canContinue}
        style={{
          width:        '100%',
          padding:      '11px 16px',
          background:   canContinue ? '#111827' : '#e5e7eb',
          color:        canContinue ? '#fff'     : '#9ca3af',
          border:       'none',
          borderRadius: 8,
          fontSize:     14,
          fontWeight:   500,
          cursor:       canContinue ? 'pointer' : 'default',
          marginTop:    4,
          transition:   'background 150ms ease',
        }}
        onMouseEnter={(e) => { if (canContinue) e.currentTarget.style.background = '#374151' }}
        onMouseLeave={(e) => { if (canContinue) e.currentTarget.style.background = '#111827' }}
      >
        Continuar a asignación →
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Charter companies — plain text, no hyperlinks.
// Hardcoded fallback used while the async /config fetch completes (or if it
// fails).  The live list comes from config.py via GET /config.
// ---------------------------------------------------------------------------

const CHARTER_PHONES_FALLBACK = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

// ---------------------------------------------------------------------------
// CharterInfoSection — shown in step 1 when charterMode is true
// Phone numbers are plain text — NOT clickable links.
// ---------------------------------------------------------------------------

function CharterInfoSection({ poolCount, onContinue }) {
  const [charterPhones, setCharterPhones] = useState(CHARTER_PHONES_FALLBACK)

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        const list = cfg.charter?.constants?.CHARTER_PHONE_LIST?.value
        if (Array.isArray(list)) setCharterPhones(list)
      })
      .catch(() => {})   // keep fallback on error
  }, [])

  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', animation: 'fadeIn 200ms ease-out' }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
        Servicio de charter requerido
      </p>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px' }}>
        El equipo de <strong style={{ color: '#111827' }}>{poolCount} personas</strong> será trasladado por charter
      </p>

      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px' }}>
        Empresas de charter
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {charterPhones.map((item) => (
          <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{item.name}</span>
            <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>{item.phone}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onContinue}
        style={{
          width: '100%', padding: '10px 16px', background: '#111827', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
          transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#374151' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#111827' }}
      >
        Continuar →
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Haversine distance in km (client-side, no API call)
// ---------------------------------------------------------------------------
function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ---------------------------------------------------------------------------
// CharterPeSelectionSection — shown in step 2 when charterMode is true
//
// Three-phase interaction:
//   1. Card click   → setSelectedPe (local) + SET_HIGHLIGHTED_PE (map preview)
//   2. "Elegir" btn → handleConfirmPe: dispatches INIT_VEHICLES, computes
//                     PE→event route via /simple-route, then advances to step 3.
//
// Route is computed BEFORE advancing so canValidate's route check passes.
// INIT_VEHICLES and SET_CURRENT_STEP are NOT delegated to Sidebar's useEffect
// (that effect now skips charter to avoid re-triggering on STEP_BACK).
// ---------------------------------------------------------------------------

function CharterPeSelectionSection() {
  const { state, dispatch } = useAppState()
  const [allPes,     setAllPes]     = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [selectedPe, setSelectedPe] = useState(null)
  const [choosing,   setChoosing]   = useState(false)

  // Manual address entry
  const [showManual,      setShowManual]      = useState(false)
  const [manualAddr,      setManualAddr]      = useState('')
  const [geocodingManual, setGeocodingManual] = useState(false)
  const [manualGeoError,  setManualGeoError]  = useState(null)
  const [manualPe,        setManualPe]        = useState(null)  // geocoded result

  // Map-click mode — user can click on the map to pick a PE location.
  const [manualPeMapMode, setManualPeMapMode] = useState(false)
  const manualPeMapRef    = useRef(false)  // ref mirror so the effect below reads latest value

  const staffWithCoords = state.staffWithCoords ?? []

  useEffect(() => {
    nearestMeetingPoint(true)
      .then((data) => setAllPes(data))
      .catch(() => setError('No se pudo obtener los puntos de encuentro.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function avgStaffDistanceKm(pe) {
    if (!staffWithCoords.length) return null
    const dists = staffWithCoords
      .filter((e) => e.coordinates)
      .map((e) => haversineKm(e.coordinates, pe))
    if (!dists.length) return null
    return dists.reduce((s, d) => s + d, 0) / dists.length
  }

  // Card click — preview only (map marker + "Elegir" button reveal)
  function handleCardClick(pe) {
    setSelectedPe(pe)
    setManualPe(null)       // deselect manual PE when a card is selected
    dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: pe })
  }

  // Manual geocode — enriches with place name via pickupPlaceInfo so the stored
  // name reflects a real place rather than the user's raw search query (Bug 4).
  async function handleManualGeocode() {
    const addr = manualAddr.trim()
    if (!addr) return
    setGeocodingManual(true)
    setManualGeoError(null)
    setManualPe(null)
    try {
      const pe = await geocodeAndEnrich(addr)
      if (!pe) throw new Error('No result')
      setManualPe(pe)
      setSelectedPe(null)   // deselect cards when manual PE is geocoded
      dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: pe })
    } catch {
      setManualGeoError('No se pudo geocodificar la dirección.')
    } finally {
      setGeocodingManual(false)
    }
  }

  // Map-click mode handlers — activates global manualPeaMode so AppMap turns
  // the cursor to crosshair and handles clicks via handleMapClickPea (charter branch).
  function handleStartMapMode() {
    manualPeMapRef.current = true
    setManualPeMapMode(true)
    setSelectedPe(null)
    dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: null })
    dispatch({ type: ACTIONS.SET_MANUAL_PEA_MODE, payload: true })
  }

  function handleCancelMapMode() {
    manualPeMapRef.current = false
    setManualPeMapMode(false)
    dispatch({ type: ACTIONS.SET_MANUAL_PEA_MODE, payload: false })
  }

  // When AppMap completes a charter map click it sets highlightedPE and clears
  // manualPeaMode.  Watch for that transition to populate manualPe in the sidebar.
  useEffect(() => {
    if (manualPeMapRef.current && !state.manualPeaMode && state.highlightedPE) {
      setManualPe(state.highlightedPE)
      setSelectedPe(null)
      manualPeMapRef.current = false
      setManualPeMapMode(false)
    }
  }, [state.manualPeaMode, state.highlightedPE])

  // "Elegir este PE" button — full confirmation: vehicles init + route + step advance
  async function handleConfirmPe(pe) {
    if (choosing) return
    setChoosing(true)

    const pool_count = state.remainingPool?.remaining_pool?.length ?? 0

    dispatch({ type: ACTIONS.SET_MEETING_POINT,        payload: pe })
    dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT, payload: pe })
    dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE,       payload: null })
    dispatch({
      type:    ACTIONS.INIT_VEHICLES,
      payload: { pool_count, charter: true, chosenMeetingPoint: pe },
    })

    // Compute PE→event route before advancing so canValidate passes.
    if (state.eventCoords) {
      try {
        const route = await simpleRoute(pe.lat, pe.lng, state.eventCoords.lat, state.eventCoords.lng)
        dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: 'charter_1', route } })
      } catch {}
    }

    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  if (loading) return (
    <p style={{ fontSize: 13, color: '#6b7280' }}>Buscando puntos de encuentro…</p>
  )
  if (error) return (
    <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>
  )
  if (!allPes) return null

  const peList = [
    allPes.recommended,
    ...(allPes.alternatives ?? []),
  ].filter(Boolean)

  const staffAvgs = peList.map((pe) => avgStaffDistanceKm(pe))
  const minAvgIdx = staffAvgs.reduce(
    (minI, d, i) => (d !== null && (staffAvgs[minI] === null || d < staffAvgs[minI])) ? i : minI,
    0,
  )

  return (
    <div style={{ animation: 'fadeIn 200ms ease-out' }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
        Punto de encuentro para el charter
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {peList.map((pe, i) => {
          const isRecommended = i === 0
          const avgDist       = staffAvgs[i]
          const isNearTeam    = i === minAvgIdx && minAvgIdx !== 0
          const isSelected    = selectedPe?.name === pe.name

          return (
            <div
              key={pe.name}
              onClick={() => !choosing && handleCardClick(pe)}
              style={{
                padding:      '12px 14px',
                background:   isSelected ? '#f0f9ff' : '#f9fafb',
                border:       isSelected
                  ? '2px solid #111827'
                  : isRecommended ? '1.5px solid #FBBC04' : '1px solid #e5e7eb',
                borderRadius: 10,
                cursor:       choosing ? 'default' : 'pointer',
                transition:   'border-color 120ms ease, background 120ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: 0, flex: 1, marginRight: 8 }}>
                  {pe.name}
                </p>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {isRecommended && (
                    <span style={{ fontSize: 10, fontWeight: 600, background: '#FBBC04', color: '#111', padding: '2px 6px', borderRadius: 10 }}>
                      Recomendado
                    </span>
                  )}
                  {isNearTeam && (
                    <span style={{ fontSize: 10, fontWeight: 600, background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 10 }}>
                      Más cercano al equipo
                    </span>
                  )}
                </div>
              </div>

              <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.4 }}>
                {pe.address}
              </p>

              {pe.duration_seconds != null && (
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 2px' }}>
                  {Math.ceil(pe.duration_seconds / 60)} min al evento desde CP
                </p>
              )}
              {avgDist != null && (
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
                  Promedio equipo: {avgDist.toFixed(1)} km
                </p>
              )}

              {/* "Elegir" button — only shown on the selected card */}
              {isSelected && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleConfirmPe(pe) }}
                  disabled={choosing}
                  style={{
                    marginTop:    10,
                    width:        '100%',
                    padding:      '8px 12px',
                    background:   choosing ? '#e5e7eb' : '#111827',
                    color:        choosing ? '#9ca3af' : '#fff',
                    border:       'none',
                    borderRadius: 6,
                    fontSize:     12,
                    fontWeight:   500,
                    cursor:       choosing ? 'default' : 'pointer',
                    transition:   'background 150ms ease',
                  }}
                  onMouseEnter={(e) => { if (!choosing) e.currentTarget.style.background = '#374151' }}
                  onMouseLeave={(e) => { if (!choosing) e.currentTarget.style.background = '#111827' }}
                >
                  {choosing ? 'Configurando…' : 'Elegir este PE →'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {!selectedPe && !manualPe && (
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 10, textAlign: 'center' }}>
          Hacé click en un PE para seleccionarlo
        </p>
      )}

      {/* ── Manual PE entry ──────────────────────────────────────────── */}
      <div style={{ marginTop: 14, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
        {!showManual ? (
          <button
            onClick={() => { setShowManual(true); setSelectedPe(null) }}
            disabled={choosing}
            style={{
              background: 'none', border: 'none', cursor: choosing ? 'default' : 'pointer',
              fontSize: 12, color: '#6b7280', textDecoration: 'underline', padding: 0,
            }}
          >
            O ingresar punto de encuentro manualmente
          </button>
        ) : (
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>
              Dirección del punto de encuentro
            </p>
            <input
              value={manualAddr}
              onChange={(e) => { setManualAddr(e.target.value); setManualPe(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleManualGeocode() }}
              placeholder="Ej: Av. Rivadavia 4500, Buenos Aires"
              style={{
                display: 'block', width: '100%', padding: '6px 10px',
                border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12,
                marginBottom: 6, boxSizing: 'border-box', outline: 'none',
              }}
            />
            {manualGeoError && (
              <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 6px' }}>{manualGeoError}</p>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                onClick={handleManualGeocode}
                disabled={geocodingManual || !manualAddr.trim()}
                style={{
                  flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 500,
                  background: geocodingManual ? '#e5e7eb' : '#111827',
                  color: geocodingManual ? '#9ca3af' : '#fff',
                  border: 'none', borderRadius: 6,
                  cursor: geocodingManual ? 'default' : 'pointer',
                }}
              >
                {geocodingManual ? 'Buscando…' : 'Buscar'}
              </button>
              <button
                onClick={() => { setShowManual(false); setManualPe(null); setManualAddr(''); handleCancelMapMode(); dispatch({ type: ACTIONS.SET_HIGHLIGHTED_PE, payload: null }) }}
                style={{
                  flex: 1, padding: '7px 0', fontSize: 12,
                  background: '#fff', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>

            {/* Map-click mode — activated by "O seleccionar en el mapa" */}
            {manualPeMapMode ? (
              <div style={{ padding: '8px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8', margin: '0 0 6px' }}>
                  Hacé click en el mapa para elegir el punto de encuentro
                </p>
                <button
                  onClick={handleCancelMapMode}
                  style={{
                    fontSize: 11, color: '#6b7280', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                  }}
                >
                  Cancelar selección en mapa
                </button>
              </div>
            ) : (
              <button
                onClick={handleStartMapMode}
                disabled={choosing}
                style={{
                  display: 'block', width: '100%', padding: '6px 0', fontSize: 12,
                  background: 'none', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 6,
                  cursor: choosing ? 'default' : 'pointer', marginBottom: 8,
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={(e) => { if (!choosing) e.currentTarget.style.background = '#f9fafb' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
              >
                O seleccionar en el mapa
              </button>
            )}

            {manualPe && (
              <div style={{ padding: '10px 12px', background: '#f0f9ff', border: '1.5px solid #111827', borderRadius: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>
                  {manualPe.name}
                </p>
                <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px', lineHeight: 1.4 }}>
                  {manualPe.address}
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); handleConfirmPe(manualPe) }}
                  disabled={choosing}
                  style={{
                    width: '100%', padding: '7px 12px',
                    background: choosing ? '#e5e7eb' : '#111827',
                    color: choosing ? '#9ca3af' : '#fff',
                    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    cursor: choosing ? 'default' : 'pointer', transition: 'background 150ms ease',
                  }}
                  onMouseEnter={(e) => { if (!choosing) e.currentTarget.style.background = '#374151' }}
                  onMouseLeave={(e) => { if (!choosing) e.currentTarget.style.background = '#111827' }}
                >
                  {choosing ? 'Configurando…' : 'Elegir este punto →'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar — main export
// ---------------------------------------------------------------------------

export default function Sidebar() {
  const { state, dispatch } = useAppState()
  const [step1Open, setStep1Open] = useState(true)

  // Use frescosResult (not currentStep > 1) so the step-1 header collapses after
  // the frescos API calls complete, even when the step-2 transition is deferred (CABA).
  const step1Done  = !!state.frescosResult
  const fr         = state.frescosResult
  const event      = state.excelData?.event
  const services   = state.excelData?.services ?? []
  const isCaba     = !!event?.is_caba
  const isCharter  = state.charterMode

  // ── INIT_VEHICLES trigger ────────────────────────────────────────────────
  // Fires once when the manager confirms a PE (chosenMeetingPoint set) while
  // vehicles is still empty.  Charter is excluded: INIT_VEHICLES, route
  // computation, and step advance are all handled synchronously in the PE
  // confirmation button (CharterPeSelectionSection.handleConfirmPe).
  useEffect(() => {
    if (!state.chosenMeetingPoint) return
    if (state.vehicles.length > 0) return
    if (!state.remainingPool)      return
    // Charter handles its own initialization in the button handler.
    if (state.charterMode)         return

    const pool_count = state.remainingPool.remaining_pool?.length ?? 0

    const has_personal_vehicle = state.personalVehicle?.has_personal_vehicle ?? false
    const driverObj            = state.personalVehicle?.driver
    const driver               = driverObj ? `${driverObj.Nombre} ${driverObj.Apellido}` : null
    const vehicle_description  = state.personalVehicle?.vehicle_description ?? null

    dispatch({
      type:    ACTIONS.INIT_VEHICLES,
      payload: { pool_count, has_personal_vehicle, driver, vehicle_description, chosenMeetingPoint: state.chosenMeetingPoint },
    })

    if (has_personal_vehicle && state.driverRoutes) {
      const isPea = state.meetingPoint &&
        state.chosenMeetingPoint?.name !== state.meetingPoint?.name
      const route = isPea ? state.driverRoutes.direct_route : state.driverRoutes.base_route
      if (route) {
        dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: 'personal', route } })
      }
    }
  }, [state.chosenMeetingPoint]) // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* ── App header ──────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '15px 20px 10px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink:   0,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Plan de traslado
        </h1>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Event info ──────────────────────────────────────────────── */}
        <EventInfoSection event={event} services={services} />

        {/* ── Step 1: Vehículo de Frescos ─────────────────────────────── */}
        <div>
          {step1Done ? (
            <>
              <button
                onClick={() => setStep1Open((v) => !v)}
                style={{
                  width:          '100%',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  padding:        '10px 20px',
                  background:     '#f9fafb',
                  border:         'none',
                  borderBottom:   '1px solid #e5e7eb',
                  cursor:         'pointer',
                  textAlign:      'left',
                  transition:     'background 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                    Vehículo de Frescos
                  </span>
                  {fr && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      — {fr.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete'}
                    </span>
                  )}
                </div>
                {step1Open
                  ? <ChevronDown  size={15} color="#9ca3af" />
                  : <ChevronRight size={15} color="#9ca3af" />
                }
              </button>
              {step1Open && (
                <div
                  style={{
                    padding:      '14px 20px',
                    borderBottom: '1px solid #e5e7eb',
                    animation:    'fadeIn 180ms ease-out',
                  }}
                >
                  <FrescosPanel />
                </div>
              )}
              {isCaba && state.currentStep === 1 && (
                <div
                  style={{
                    padding:      '16px 20px',
                    borderBottom: '1px solid #e5e7eb',
                    animation:    'fadeIn 200ms ease-out',
                  }}
                >
                  <CabaPanel />
                </div>
              )}
              {isCharter && state.currentStep === 1 && (
                <CharterInfoSection
                  poolCount={state.remainingPool?.remaining_count ?? 0}
                  onContinue={() => dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 2 })}
                />
              )}
            </>
          ) : (
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
                Vehículo de Frescos
              </p>
              <FrescosPanel />
            </div>
          )}
        </div>

        {/* ── Step 2: Punto de encuentro ───────────────────────────────── */}
        {state.currentStep >= 2 && (
          <div style={{ padding: '16px 20px', animation: 'fadeIn 200ms ease-out' }}>
            {isCharter
              ? <CharterPeSelectionSection />
              : isCaba && state.cabaDecisionToTransport && !state.meetingPoint
                ? <CabaPeSelectionPanel />
                : (!isCaba || state.meetingPoint)
                  ? <PeaPanel />
                  : null
            }
          </div>
        )}

        {/* ── Step 2b: Uber route tracing ───────────────────────────────── */}
        {/* Shown once chosenMeetingPoint is confirmed and vehicles are ready. */}
        {/* Skipped for charter — charter does not use the vehicles/Uber model.  */}
        {state.currentStep >= 2 && state.chosenMeetingPoint && state.vehicles.length > 0 && !isCharter && (
          <UberRoutesSection />
        )}
      </div>
    </div>
  )
}
