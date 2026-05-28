/**
 * FrescosPanel.jsx
 * Content for the frescos vehicle question and its result summary.
 * Rendered inside Sidebar — no absolute positioning, no Card wrapper.
 *
 * All logic, API calls, and state dispatches are IDENTICAL to the original.
 * Only the outermost DOM structure changed: the position:absolute div and
 * the <Card> wrapper are removed so the content renders flat inside Sidebar's
 * padded section container.
 *
 * ── Why all 4 backend calls happen in one handler ─────────────────────────
 * See original component comment — unchanged rationale.
 */

import { useState }                from 'react'
import { useAppState, ACTIONS }    from '../../state/appState'
import {
  determineFrescos,
  determineSecondMiniflete,
  getRemainingPool,
  detectPersonalVehicle,
} from '../../api/endpoints'
import { Button }                  from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Internal helper — derive Profesion strings from assigned names.
// Unchanged from original.
// ---------------------------------------------------------------------------
function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((fullName) =>
      staff.find(
        (emp) => `${emp.Nombre} ${emp.Apellido}` === fullName,
      )?.Profesion,
    )
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Sub-component: the van question
// ---------------------------------------------------------------------------

function VanQuestion({ onAnswer, loading }) {
  return (
    <>
      <p style={{ fontSize: 14, fontWeight: 500, color: '#111827', margin: '0 0 10px' }}>
        ¿Está disponible el Vehículo QH?
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => onAnswer(true)} disabled={loading}>
          {loading === 'si' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            'Sí'
          )}
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          onClick={() => onAnswer(false)}
          disabled={loading}
        >
          {loading === 'no' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          ) : (
            'No'
          )}
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: result summary
// ---------------------------------------------------------------------------

function FrescosSummary({ frescosResult, secondMiniflete, remainingPool, personalVehicle }) {
  const hasVehicle = personalVehicle?.has_personal_vehicle
  const driver     = personalVehicle?.driver
  const carWarning = personalVehicle?.warning
  const poolStatus = remainingPool?.status

  return (
    <div className="space-y-3 text-sm">
      {/* Frescos vehicle */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vehículo frescos
        </p>
        <p className="font-medium">
          {frescosResult.vehicle === 'camioneta propia'
            ? 'Vehículo QH'
            : 'Miniflete contratado'}
        </p>
        <p className="text-xs text-muted-foreground">
          {frescosResult.assigned_names.join(', ')}
        </p>
      </div>

      {/* Second miniflete */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Segundo miniflete
        </p>
        <p className={secondMiniflete.needs_second_miniflete ? 'font-medium text-amber-600' : 'text-muted-foreground'}>
          {secondMiniflete.needs_second_miniflete ? 'Sí requerido' : 'No requerido'}
        </p>
        <p className="text-xs text-muted-foreground">{secondMiniflete.reason}</p>
      </div>

      {/* Remaining pool */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pool restante
        </p>
        {poolStatus === 'proceed' && (
          <p>{remainingPool.remaining_count} empleados para asignar</p>
        )}
        {poolStatus === 'charter' && (
          <p className="font-medium text-destructive">
            ⚠ Charter requerido ({remainingPool.remaining_count} personas)
          </p>
        )}
        {poolStatus === 'alternative' && (
          <p className="font-medium text-destructive">
            ⚠ Solo 1 persona — buscar alternativa
          </p>
        )}
      </div>

      {/* Personal vehicle */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vehículo personal
        </p>
        {hasVehicle ? (
          <>
            <p>
              {driver.Nombre} {driver.Apellido} — {personalVehicle.vehicle_description}
            </p>
            {carWarning && (
              <p className="text-xs text-amber-600">{carWarning}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Sin vehículo personal</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: inline assignment editor
// ---------------------------------------------------------------------------

function FrescosEditSection({ assignedNames, staff, saving, onConfirm, onCancel }) {
  const [selections, setSelections] = useState([...assignedNames])

  function handleChange(idx, value) {
    const next = [...selections]
    next[idx]  = value
    setSelections(next)
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {assignedNames.map((_, idx) => (
        <div key={idx} className="space-y-1">
          <p className="text-xs text-muted-foreground">Empleado {idx + 1}</p>
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={selections[idx]}
            onChange={(e) => handleChange(idx, e.target.value)}
          >
            {staff.map((emp) => {
              const name = `${emp.Nombre} ${emp.Apellido}`
              return (
                <option key={name} value={name}>
                  {name} — {emp.Profesion}
                </option>
              )
            })}
          </select>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" onClick={() => onConfirm(selections)} disabled={saving}>
          {saving ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            'Confirmar cambio'
          )}
        </Button>
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — renders flat content (no Card wrapper, no absolute div)
// ---------------------------------------------------------------------------

export default function FrescosPanel() {
  const { state, dispatch } = useAppState()

  const [activeButton, setActiveButton] = useState(null)
  const [editing,      setEditing]      = useState(false)
  const [editSaving,   setEditSaving]   = useState(false)
  const [editError,    setEditError]    = useState(null)

  const staff  = state.excelData?.staff ?? []
  // Use frescosResult (not currentStep) so the summary shows immediately after
  // the API calls complete, even when the step-2 transition is deferred (CABA).
  const done   = !!state.frescosResult

  async function handleAnswer(hasOwnVan) {
    setActiveButton(hasOwnVan ? 'si' : 'no')
    dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'frescos' })
    dispatch({ type: ACTIONS.SET_ERROR,        payload: null })

    try {
      const frescosResult = await determineFrescos({ has_own_van: hasOwnVan })
      dispatch({ type: ACTIONS.SET_FRESCOS_RESULT, payload: frescosResult })

      const secondMiniflete = await determineSecondMiniflete()
      dispatch({ type: ACTIONS.SET_SECOND_MINIFLETE, payload: secondMiniflete })

      const assignedRoles = deriveProfesiones(frescosResult.assigned_names, staff)
      const remainingPool = await getRemainingPool({ assigned_roles: assignedRoles })
      dispatch({ type: ACTIONS.SET_REMAINING_POOL, payload: remainingPool })

      const personalVehicle = await detectPersonalVehicle()
      dispatch({ type: ACTIONS.SET_PERSONAL_VEHICLE, payload: personalVehicle })

      dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })

      // For CABA events, stay in step 1 — the CabaPanel will appear in the
      // sidebar below the frescos summary and the manager decides next.
      // For all other events, advance immediately to step 2 (PEA flow).
      const isCaba = state.excelData?.event?.is_caba
      if (!isCaba) {
        dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 2 })
      }
    } catch (err) {
      dispatch({
        type:    ACTIONS.SET_ERROR,
        payload: err?.response?.data?.detail ??
                 err?.message ??
                 'Error al determinar el vehículo de frescos.',
      })
    } finally {
      setActiveButton(null)
    }
  }

  async function handleEditConfirm(newNames) {
    setEditSaving(true)
    setEditError(null)
    try {
      const updatedFrescos = { ...state.frescosResult, assigned_names: newNames }
      dispatch({ type: ACTIONS.SET_FRESCOS_RESULT, payload: updatedFrescos })

      const newRoles = deriveProfesiones(newNames, staff)
      const newPool  = await getRemainingPool({ assigned_roles: newRoles })
      dispatch({ type: ACTIONS.SET_REMAINING_POOL, payload: newPool })
      setEditing(false)
    } catch (err) {
      setEditError(
        err?.response?.data?.detail ??
        err?.message ??
        'Error al actualizar la asignación.',
      )
    } finally {
      setEditSaving(false)
    }
  }

  function openEdit()   { setEditing(true);  setEditError(null) }
  function cancelEdit() { setEditing(false); setEditError(null) }

  return (
    <div className="space-y-3">
      {done ? (
        <>
          <FrescosSummary
            frescosResult={state.frescosResult}
            secondMiniflete={state.secondMinifleteResult}
            remainingPool={state.remainingPool}
            personalVehicle={state.personalVehicle}
          />
          {!editing ? (
            <button
              className="text-xs text-gray-500 underline hover:text-gray-700 cursor-pointer"
              onClick={openEdit}
            >
              Editar asignación
            </button>
          ) : (
            <FrescosEditSection
              assignedNames={state.frescosResult.assigned_names}
              staff={staff}
              saving={editSaving}
              onConfirm={handleEditConfirm}
              onCancel={cancelEdit}
            />
          )}
          {editError && (
            <p className="text-xs text-destructive">{editError}</p>
          )}
        </>
      ) : (
        <VanQuestion onAnswer={handleAnswer} loading={activeButton} />
      )}

      {state.error && !done && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </div>
  )
}
