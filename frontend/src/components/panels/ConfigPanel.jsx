/**
 * ConfigPanel.jsx
 * Settings panel that displays and edits all config.py constants.
 *
 * ── Layout ────────────────────────────────────────────────────────────────────
 * Full-height panel pinned to the right edge of the map container.
 * Scrollable body; header and footer buttons are sticky.
 *
 * ── Data flow ─────────────────────────────────────────────────────────────────
 * On mount: GET /config → `config` state (grouped categories + values).
 * User edits: tracked in `localChanges` (parsed values) and `rawJson` (raw
 *   textarea text for dict/list constants, which may be temporarily invalid JSON
 *   while the user is mid-edit).
 * Save: POST /config with only the changed values → reload from response.
 * Reset: POST /config-reset → reload from response.
 *
 * ── Why inline styles, not Tailwind? ─────────────────────────────────────────
 * The panel uses a mix of absolute positioning and dynamic styles (blue border
 * on changed fields) that are cleaner expressed inline.  The component is
 * self-contained and uses no Maps API DOM subtrees, so Tailwind would work too,
 * but inline styles keep all layout logic visible in one place.
 */

import { useState, useEffect } from 'react'
import { X, Settings }        from 'lucide-react'
import { getConfig, updateConfig, resetConfig } from '../../api/endpoints'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Determine the logical type of a config value for input rendering and parsing.
 * Returns 'int', 'float', 'string', or 'json' (dict or list).
 */
function valueType(val) {
  if (typeof val === 'number') return Number.isInteger(val) ? 'int' : 'float'
  if (typeof val === 'string') return 'string'
  return 'json'
}

/**
 * Parse a raw string from a number input back to the appropriate JS type.
 * Returns null if the string does not represent a valid finite number.
 */
function parseNumber(raw, type) {
  const n = type === 'int' ? parseInt(raw, 10) : parseFloat(raw)
  return isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Shared input style
// ---------------------------------------------------------------------------

const INPUT_BASE = {
  width:         '100%',
  padding:       '5px 8px',
  border:        '1px solid #d1d5db',
  borderRadius:  5,
  boxSizing:     'border-box',
  fontSize:      12,
  fontFamily:    'system-ui, sans-serif',
  outline:       'none',
}

// ---------------------------------------------------------------------------
// Spanish labels for SECOND_MINIFLETE_CONDITIONS keys
// ---------------------------------------------------------------------------

const MINIFLETE_KEY_LABELS = {
  'asado tradicional':      'Asado tradicional',
  'asado finger food':      'Asado finger food',
  'acompañamiento bebidas': 'Acompañamiento bebidas',
}

// ---------------------------------------------------------------------------
// SecondMinifleteRow — renders SECOND_MINIFLETE_CONDITIONS as individual inputs
//
// Instead of exposing the raw dict as a JSON textarea, each key-value pair
// gets its own labeled number input.  This is less error-prone (no JSON syntax
// to type) and matches how a manager thinks about the thresholds.
//
// When saving, the three inputs are reconstructed into the same dict shape
// that the backend expects, so POST /config requires no backend changes.
// ---------------------------------------------------------------------------

function SecondMinifleteRow({ name, meta, localChanges, onChange }) {
  const currentDict = (name in localChanges) ? localChanges[name] : meta.value
  const isChanged   = name in localChanges
  const borderLeft  = isChanged ? '3px solid #2563EB' : '3px solid transparent'
  const inputBg     = isChanged ? '#eff6ff' : '#fff'

  function handleSubChange(key, raw) {
    const n = parseInt(raw, 10)
    if (!isFinite(n)) return
    const updated = { ...currentDict, [key]: n }
    // Reconstruct the full dict and route through onJsonChange (passed as onChange)
    // so the parent parses it and stores the object in localChanges correctly.
    onChange(name, JSON.stringify(updated))
  }

  return (
    <div style={{ marginBottom: 14, paddingLeft: 8, borderLeft }}>
      <p style={{
        fontFamily: 'monospace',
        fontSize:   11,
        fontWeight: 600,
        color:      '#1f2937',
        margin:     '0 0 2px',
      }}>
        {name}
      </p>
      <p style={{
        fontSize:   11,
        color:      '#9ca3af',
        margin:     '0 0 5px',
        lineHeight: 1.45,
      }}>
        {meta.description}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(currentDict).map(([key, val]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{
              fontSize:   11,
              color:      '#374151',
              flexShrink: 0,
              width:      160,
            }}>
              {MINIFLETE_KEY_LABELS[key] ?? key}
            </label>
            <input
              type="number"
              step="1"
              value={val}
              onChange={(e) => handleSubChange(key, e.target.value)}
              style={{ ...INPUT_BASE, width: 80, background: inputBg }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConstantRow — renders name, description, and editable input for one constant
// ---------------------------------------------------------------------------

function ConstantRow({ name, meta, localChanges, rawJson, onChange, onJsonChange }) {
  // SECOND_MINIFLETE_CONDITIONS gets its own component for a friendlier UX.
  if (name === 'SECOND_MINIFLETE_CONDITIONS') {
    return (
      <SecondMinifleteRow
        name={name}
        meta={meta}
        localChanges={localChanges}
        onChange={onJsonChange}
      />
    )
  }

  const type       = valueType(meta.value)
  const isChanged  = name in localChanges
  const isJsonType = type === 'json'

  // Display value: for JSON fields use rawJson (may be in-progress text);
  // for scalars show the current parsed value (original or changed).
  const displayVal = isJsonType
    ? (rawJson[name] !== undefined
        ? rawJson[name]
        : JSON.stringify(meta.value, null, 2))
    : String(isChanged ? localChanges[name] : meta.value)

  const borderLeft = isChanged ? '3px solid #2563EB' : '3px solid transparent'
  const inputBg    = isChanged ? '#eff6ff' : '#fff'

  return (
    <div style={{ marginBottom: 14, paddingLeft: 8, borderLeft }}>
      <p style={{
        fontFamily:  'monospace',
        fontSize:    11,
        fontWeight:  600,
        color:       '#1f2937',
        margin:      '0 0 2px',
      }}>
        {name}
      </p>
      <p style={{
        fontSize:    11,
        color:       '#9ca3af',
        margin:      '0 0 5px',
        lineHeight:  1.45,
      }}>
        {meta.description}
      </p>

      {isJsonType ? (
        <textarea
          value={displayVal}
          onChange={(e) => onJsonChange(name, e.target.value)}
          rows={Array.isArray(meta.value) ? 3 : 5}
          style={{
            ...INPUT_BASE,
            fontFamily: 'monospace',
            fontSize:   11,
            resize:     'vertical',
            background: inputBg,
          }}
        />
      ) : (
        <input
          type={type === 'string' ? 'text' : 'number'}
          step={type === 'float'  ? 'any'  : '1'}
          value={displayVal}
          onChange={(e) => onChange(name, e.target.value, type)}
          style={{ ...INPUT_BASE, background: inputBg }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * @param {{ onClose: () => void }} props
 */
export default function ConfigPanel({ onClose }) {
  const [config,       setConfig]       = useState(null)
  const [localChanges, setLocalChanges] = useState({})
  // rawJson holds the current textarea text for JSON fields (dict / list).
  // It is separate from localChanges because the user may be mid-edit with
  // temporarily invalid JSON, and we don't want to lose their text.
  const [rawJson,      setRawJson]      = useState({})
  const [saving,       setSaving]       = useState(false)
  const [resetting,    setResetting]    = useState(false)
  const [message,      setMessage]      = useState(null)   // brief status toast
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    getConfig().then(setConfig).catch(console.error)
  }, [])

  function showMessage(text, isError = false) {
    setMessage({ text, isError })
    setTimeout(() => setMessage(null), 2500)
  }

  // ── Scalar input change ────────────────────────────────────────────────────
  function handleChange(name, raw, type) {
    if (type === 'string') {
      setLocalChanges((prev) => ({ ...prev, [name]: raw }))
      return
    }
    const parsed = parseNumber(raw, type)
    if (parsed !== null) {
      setLocalChanges((prev) => ({ ...prev, [name]: parsed }))
    }
  }

  // ── JSON textarea change ───────────────────────────────────────────────────
  function handleJsonChange(name, raw) {
    setRawJson((prev) => ({ ...prev, [name]: raw }))
    try {
      const parsed = JSON.parse(raw)
      setLocalChanges((prev) => ({ ...prev, [name]: parsed }))
    } catch {
      // Invalid JSON while editing — remove from localChanges so that
      // "Guardar" cannot submit a broken value.
      setLocalChanges((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (Object.keys(localChanges).length === 0) return
    setSaving(true)
    try {
      const newConfig = await updateConfig(localChanges)
      setConfig(newConfig)
      setLocalChanges({})
      setRawJson({})
      showMessage('✓ Guardado')
    } catch (e) {
      const detail = e?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : detail?.errors?.join(', ') ?? 'Error al guardar'
      showMessage(msg, true)
    } finally {
      setSaving(false)
    }
  }

  // ── Factory reset ──────────────────────────────────────────────────────────
  async function handleConfirmReset() {
    setResetting(true)
    try {
      const newConfig = await resetConfig()
      setConfig(newConfig)
      setLocalChanges({})
      setRawJson({})
      setConfirmReset(false)
      showMessage('✓ Restaurado')
    } catch {
      showMessage('Error al restaurar', true)
    } finally {
      setResetting(false)
    }
  }

  const hasChanges = Object.keys(localChanges).length > 0

  return (
    <div style={{
      position:   'absolute',
      top:        0,
      right:      0,
      bottom:     0,
      width:      360,
      background: '#fff',
      boxShadow:  '-4px 0 24px rgba(0,0,0,0.12)',
      display:    'flex',
      flexDirection: 'column',
      zIndex:     50,
      fontFamily: 'system-ui, sans-serif',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '13px 16px',
        borderBottom:   '1px solid #e5e7eb',
        flexShrink:     0,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>
          Configuración
        </h2>

        {/* Brief status toast shown between the title and close button */}
        {message && (
          <span style={{
            fontSize:   12,
            fontWeight: 500,
            color:      message.isError ? '#dc2626' : '#16a34a',
          }}>
            {message.text}
          </span>
        )}

        <button
          onClick={onClose}
          aria-label="Cerrar panel de configuración"
          style={{
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            padding:    4,
            color:      '#6b7280',
            display:    'flex',
            alignItems: 'center',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Scrollable constant list ────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!config ? (
          <p style={{
            color:      '#9ca3af',
            fontSize:   13,
            textAlign:  'center',
            marginTop:  48,
          }}>
            Cargando…
          </p>
        ) : (
          Object.entries(config).map(([catKey, cat]) => (
            <div key={catKey} style={{ marginBottom: 22 }}>
              {/* Category header */}
              <p style={{
                fontSize:       11,
                fontWeight:     700,
                color:          '#374151',
                textTransform:  'uppercase',
                letterSpacing:  '0.06em',
                margin:         '0 0 10px',
                paddingBottom:  5,
                borderBottom:   '1px solid #f3f4f6',
              }}>
                {cat.label}
              </p>

              {Object.entries(cat.constants).map(([name, meta]) => (
                <ConstantRow
                  key={name}
                  name={name}
                  meta={meta}
                  localChanges={localChanges}
                  rawJson={rawJson}
                  onChange={handleChange}
                  onJsonChange={handleJsonChange}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* ── Sticky footer buttons ───────────────────────────────────────────── */}
      <div style={{
        padding:       '12px 16px',
        borderTop:     '1px solid #e5e7eb',
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        flexShrink:    0,
      }}>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          style={{
            padding:    '8px 16px',
            background: hasChanges && !saving ? '#111827' : '#d1d5db',
            color:      '#fff',
            border:     'none',
            borderRadius: 6,
            fontSize:   13,
            fontWeight: 500,
            cursor:     hasChanges && !saving ? 'pointer' : 'default',
          }}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>

        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            style={{
              padding:      '8px 16px',
              background:   '#fff',
              color:        '#dc2626',
              border:       '1px solid #fca5a5',
              borderRadius: 6,
              fontSize:     12,
              cursor:       'pointer',
            }}
          >
            Restaurar ajustes predeterminados
          </button>
        ) : (
          /* Inline confirmation dialog — avoids a separate modal overlay */
          <div style={{
            background:   '#fef2f2',
            border:       '1px solid #fca5a5',
            borderRadius: 6,
            padding:      '10px 12px',
          }}>
            <p style={{
              fontSize:    12,
              color:       '#7f1d1d',
              margin:      '0 0 8px',
              lineHeight:  1.45,
            }}>
              ¿Restaurar todos los valores a los predeterminados originales?
              Esto sobreescribirá cualquier cambio guardado.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleConfirmReset}
                disabled={resetting}
                style={{
                  flex:         1,
                  padding:      '6px',
                  background:   '#dc2626',
                  color:        '#fff',
                  border:       'none',
                  borderRadius: 5,
                  fontSize:     12,
                  cursor:       resetting ? 'default' : 'pointer',
                }}
              >
                {resetting ? 'Restaurando…' : 'Confirmar'}
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                style={{
                  flex:         1,
                  padding:      '6px',
                  background:   '#fff',
                  color:        '#374151',
                  border:       '1px solid #d1d5db',
                  borderRadius: 5,
                  fontSize:     12,
                  cursor:       'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GearButton — exported separately so AppMap can render it outside the panel
// ---------------------------------------------------------------------------

/**
 * Fixed gear icon button in the top-right corner of the map container.
 * Rendered as a sibling of <Map> so it layers over the map canvas.
 *
 * @param {{ onClick: () => void, active: boolean }} props
 */
export function GearButton({ onClick, active }) {
  return (
    <button
      onClick={onClick}
      aria-label="Abrir configuración"
      style={{
        position:       'absolute',
        top:            12,
        right:          12,
        zIndex:         40,
        width:          40,
        height:         40,
        background:     'none',
        border:         'none',
        boxShadow:      'none',
        cursor:         'pointer',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        color:          active ? '#111827' : '#4B5563',
        padding:        0,
      }}
    >
      <Settings size={20} />
    </button>
  )
}
